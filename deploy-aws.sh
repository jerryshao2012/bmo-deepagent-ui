#!/bin/bash
set -e

# Timer tracking
TOTAL_START_TIME=$(date +%s)
STEP_TIMES=()

# Function to track step timing
start_step() {
  STEP_NAME="$1"
  STEP_START=$(date +%s)
  echo "⏱️  Starting: $STEP_NAME"
}

end_step() {
  STEP_END=$(date +%s)
  DURATION=$((STEP_END - STEP_START))
  STEP_TIMES+=("$STEP_NAME: ${DURATION}s")
  echo "✅ Completed: $STEP_NAME (${DURATION}s)"
  echo ""
}

print_timing_summary() {
  TOTAL_END=$(date +%s)
  TOTAL_DURATION=$((TOTAL_END - TOTAL_START_TIME))
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "⏱️  Deployment Timing Summary"
  echo "═══════════════════════════════════════════════════════"
  for timing in "${STEP_TIMES[@]}"; do
    echo "   • $timing"
  done
  echo "───────────────────────────────────────────────────────"
  echo "   Total deployment time: ${TOTAL_DURATION}s"
  echo "═══════════════════════════════════════════════════════"
}

# Parse command-line arguments
SKIP_INFRA_SETUP=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-infra-setup)
      SKIP_INFRA_SETUP=true
      shift
      ;;
    --help|-h)
      echo "Usage: ./deploy-aws.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --skip-infra-setup Fast deployment (skips IAM, VPC, and ALB creation checks)"
      echo "  --help, -h         Show this help message"
      echo ""
      echo "Examples:"
      echo "  ./deploy-aws.sh                                    # Full deployment to AWS ECS + ALB"
      echo "  ./deploy-aws.sh --skip-infra-setup                 # Update ECS service deployment only"
      echo ""
      echo "Note: To build the image, run:"
      echo "  ./build-aws.sh"
      exit 0
      ;;
    *)
      echo "❌ Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Configuration
source ./env-aws.sh

# Overwrite with docker/production environment variables if they exist
if [ -f .env.docker ]; then
  echo "📖 Loading production environment variables from .env.docker..."
  while IFS='=' read -r key value; do
    [[ $key =~ ^#.* ]] || [[ -z $key ]] && continue
    value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
    export "$key=$value"
  done < .env.docker
fi

echo "🚀 Starting Deep Agent UI deployment on AWS ECS Fargate + ALB..."

# 1. Set AWS CLI Session
start_step "Verify AWS Authentication"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
if [ -z "$AWS_ACCOUNT_ID" ]; then
  echo "❌ Error: Not authenticated with AWS. Please run 'aws configure' or check credentials."
  exit 1
fi
echo "✅ Authenticated with AWS Account: $AWS_ACCOUNT_ID"
end_step

# 2. Verify image exists in ECR
start_step "Verify Container Image"
if ! aws ecr describe-images --repository-name "$ECR_REPO_NAME" --image-ids imageTag=latest --region "$AWS_REGION" &>/dev/null; then
  echo "⚠️  WARNING: Image 'latest' not found in ECR repository '$ECR_REPO_NAME'!"
  echo "   Please run './build-aws.sh' first to build and push the image."
  exit 1
fi
echo "✅ Verified image exists in ECR"
end_step

# ECS Resource Names
CLUSTER_NAME="${APP_NAME}-cluster"
SERVICE_NAME="${APP_NAME}-svc"
TASK_FAMILY="${APP_NAME}-task"
EXECUTION_ROLE_NAME="EcsTaskExecutionRole-${SEED}"
TASK_ROLE_NAME="EcsTaskRole-${SEED}"
ALB_NAME="${APP_NAME}-alb"
TG_NAME="${APP_NAME}-tg"
LOG_GROUP_NAME="/ecs/${APP_NAME}"

# 3. Infrastructure Setup
if [ "$SKIP_INFRA_SETUP" = false ]; then
  start_step "Secrets Manager Validation"
  if [ -f "./secrets-aws.sh" ]; then
    echo "🔑 Running secrets-aws.sh to populate/verify Secrets Manager config..."
    ./secrets-aws.sh
  fi
  
  SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$SECRETS_MANAGER_NAME" --query ARN --output text --region "$AWS_REGION" 2>/dev/null || echo "")
  if [ -z "$SECRET_ARN" ] || [ "$SECRET_ARN" = "None" ]; then
    echo "❌ Error: Secrets Manager Secret '$SECRETS_MANAGER_NAME' not found!"
    exit 1
  fi
  echo "✅ Secrets Manager Secret ARN: $SECRET_ARN"
  end_step

  start_step "IAM Roles Setup"
  # Task Execution Role (pulls image, reads secrets, writes logs)
  TRUST_POLICY_FILE=$(mktemp)
  cat > "$TRUST_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

  EXECUTION_ROLE_ARN=$(aws iam get-role --role-name "$EXECUTION_ROLE_NAME" --query "Role.Arn" --output text 2>/dev/null || echo "")
  if [ -z "$EXECUTION_ROLE_ARN" ] || [ "$EXECUTION_ROLE_ARN" = "None" ]; then
    echo "✨ Creating ECS Task Execution Role '$EXECUTION_ROLE_NAME'..."
    EXECUTION_ROLE_ARN=$(aws iam create-role --role-name "$EXECUTION_ROLE_NAME" --assume-role-policy-document "file://$TRUST_POLICY_FILE" --query "Role.Arn" --output text)
    aws iam attach-role-policy --role-name "$EXECUTION_ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
  fi

  # Policy for secrets access
  SECRETS_POLICY_FILE=$(mktemp)
  cat > "$SECRETS_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "$SECRET_ARN"
    }
  ]
}
EOF
  aws iam put-role-policy --role-name "$EXECUTION_ROLE_NAME" --policy-name "ECSSecretAccess" --policy-document "file://$SECRETS_POLICY_FILE"

  # Task Role (for the container application itself to call AWS services)
  TASK_ROLE_ARN=$(aws iam get-role --role-name "$TASK_ROLE_NAME" --query "Role.Arn" --output text 2>/dev/null || echo "")
  if [ -z "$TASK_ROLE_ARN" ] || [ "$TASK_ROLE_ARN" = "None" ]; then
    echo "✨ Creating ECS Task Role '$TASK_ROLE_NAME'..."
    TASK_ROLE_ARN=$(aws iam create-role --role-name "$TASK_ROLE_NAME" --assume-role-policy-document "file://$TRUST_POLICY_FILE" --query "Role.Arn" --output text)
  fi
  
  rm -f "$TRUST_POLICY_FILE" "$SECRETS_POLICY_FILE"
  echo "✅ IAM Roles configured."
  end_step

  start_step "Networking (VPC & Security Groups)"
  VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query "Vpcs[0].VpcId" --output text --region "$AWS_REGION")
  if [ -z "$VPC_ID" ] || [ "$VPC_ID" = "None" ]; then
    echo "❌ Error: No default VPC found in region $AWS_REGION. Cannot proceed without a VPC."
    exit 1
  fi
  
  SUBNETS_LIST=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID --query "Subnets[*].SubnetId" --output text --region "$AWS_REGION")
  SUBNETS_ARRAY=($SUBNETS_LIST)
  if [ ${#SUBNETS_ARRAY[@]} -lt 2 ]; then
    echo "❌ Error: ALB requires at least 2 subnets in different Availability Zones."
    exit 1
  fi
  # Space-separated list for AWS CLI arrays
  SUBNET_IDS="${SUBNETS_ARRAY[*]}"
  
  # ALB Security Group
  ALB_SG_NAME="${APP_NAME}-alb-sg"
  ALB_SG_ID=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$ALB_SG_NAME Name=vpc-id,Values=$VPC_ID --query "SecurityGroups[0].GroupId" --output text --region "$AWS_REGION" 2>/dev/null || echo "")
  if [ -z "$ALB_SG_ID" ] || [ "$ALB_SG_ID" = "None" ]; then
    echo "✨ Creating Security Group for ALB..."
    ALB_SG_ID=$(aws ec2 create-security-group --group-name $ALB_SG_NAME --description "SG for $APP_NAME ALB" --vpc-id $VPC_ID --query "GroupId" --output text --region "$AWS_REGION")
    aws ec2 authorize-security-group-ingress --group-id $ALB_SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 --region "$AWS_REGION"
  fi

  # ECS Security Group
  ECS_SG_NAME="${APP_NAME}-ecs-sg"
  ECS_SG_ID=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$ECS_SG_NAME Name=vpc-id,Values=$VPC_ID --query "SecurityGroups[0].GroupId" --output text --region "$AWS_REGION" 2>/dev/null || echo "")
  if [ -z "$ECS_SG_ID" ] || [ "$ECS_SG_ID" = "None" ]; then
    echo "✨ Creating Security Group for ECS Tasks..."
    ECS_SG_ID=$(aws ec2 create-security-group --group-name $ECS_SG_NAME --description "SG for $APP_NAME ECS Tasks" --vpc-id $VPC_ID --query "GroupId" --output text --region "$AWS_REGION")
    aws ec2 authorize-security-group-ingress --group-id $ECS_SG_ID --protocol tcp --port 3000 --source-group $ALB_SG_ID --region "$AWS_REGION"
  fi
  
  echo "✅ Networking configured. VPC: $VPC_ID"
  end_step

  start_step "Application Load Balancer Setup"
  # Target Group
  TG_ARN=$(aws elbv2 describe-target-groups --names $TG_NAME --query "TargetGroups[0].TargetGroupArn" --output text --region "$AWS_REGION" 2>/dev/null || echo "")
  if [ -z "$TG_ARN" ] || [ "$TG_ARN" = "None" ]; then
    echo "✨ Creating Target Group..."
    TG_ARN=$(aws elbv2 create-target-group --name $TG_NAME --protocol HTTP --port 3000 --vpc-id $VPC_ID --target-type ip --health-check-path "/" --health-check-interval-seconds 30 --health-check-timeout-seconds 5 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --query "TargetGroups[0].TargetGroupArn" --output text --region "$AWS_REGION")
  fi

  # Application Load Balancer
  ALB_ARN=$(aws elbv2 describe-load-balancers --names $ALB_NAME --query "LoadBalancers[0].LoadBalancerArn" --output text --region "$AWS_REGION" 2>/dev/null || echo "")
  if [ -z "$ALB_ARN" ] || [ "$ALB_ARN" = "None" ]; then
    echo "✨ Creating Application Load Balancer..."
    # Convert space-separated array to space-separated arguments
    ALB_ARN=$(aws elbv2 create-load-balancer --name $ALB_NAME --subnets ${SUBNETS_ARRAY[@]} --security-groups $ALB_SG_ID --scheme internet-facing --type application --query "LoadBalancers[0].LoadBalancerArn" --output text --region "$AWS_REGION")
    
    echo "⏳ Waiting for ALB to become active..."
    aws elbv2 wait load-balancer-available --load-balancer-arns $ALB_ARN --region "$AWS_REGION"
  fi
  
  ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN --query "LoadBalancers[0].DNSName" --output text --region "$AWS_REGION")

  # Listener
  LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn $ALB_ARN --query "Listeners[?Port==\`80\`].ListenerArn | [0]" --output text --region "$AWS_REGION" 2>/dev/null || echo "")
  if [ -z "$LISTENER_ARN" ] || [ "$LISTENER_ARN" = "None" ]; then
    echo "✨ Creating ALB Listener..."
    aws elbv2 create-listener --load-balancer-arn $ALB_ARN --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=$TG_ARN --region "$AWS_REGION" > /dev/null
  fi
  
  echo "✅ ALB Setup complete. DNS: http://$ALB_DNS"
  end_step

  start_step "CloudFront Setup"
  CF_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='CloudFront for ${APP_NAME}'].Id | [0]" --output text 2>/dev/null || echo "None")
  
  if [ -z "$CF_ID" ] || [ "$CF_ID" = "None" ] || [ "$CF_ID" = "null" ]; then
    echo "✨ Creating CloudFront Distribution for HTTPS and WebSocket proxying..."
    CF_CONFIG_FILE=$(mktemp)
    cat > "$CF_CONFIG_FILE" <<EOF
{
  "CallerReference": "$(date +%s)",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "ALB-Origin",
        "DomainName": "$ALB_DNS",
        "CustomOriginConfig": {
          "HTTPPort": 80,
          "HTTPSPort": 443,
          "OriginProtocolPolicy": "http-only",
          "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] }
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "ALB-Origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3"
  },
  "Comment": "CloudFront for ${APP_NAME}",
  "Enabled": true
}
EOF
    CF_DOMAIN=$(aws cloudfront create-distribution --distribution-config "file://$CF_CONFIG_FILE" --query "Distribution.DomainName" --output text)
    rm -f "$CF_CONFIG_FILE"
  else
    CF_DOMAIN=$(aws cloudfront get-distribution --id "$CF_ID" --query "Distribution.DomainName" --output text)
  fi
  echo "✅ CloudFront configured. Domain: https://$CF_DOMAIN"
  end_step

  start_step "CloudWatch Logs Setup"
  if ! aws logs describe-log-groups --log-group-name-prefix $LOG_GROUP_NAME --query "logGroups[?logGroupName=='$LOG_GROUP_NAME'].logGroupName" --output text --region "$AWS_REGION" | grep -q "$LOG_GROUP_NAME"; then
    echo "✨ Creating CloudWatch Log Group..."
    aws logs create-log-group --log-group-name $LOG_GROUP_NAME --region "$AWS_REGION"
  fi
  echo "✅ CloudWatch Log Group configured."
  end_step

  start_step "ECS Cluster Setup"
  CLUSTER_ARN=$(aws ecs describe-clusters --clusters $CLUSTER_NAME --query "clusters[0].clusterArn" --output text --region "$AWS_REGION" 2>/dev/null || echo "")
  if [ -z "$CLUSTER_ARN" ] || [ "$CLUSTER_ARN" = "None" ]; then
    echo "✨ Creating ECS Cluster..."
    CLUSTER_ARN=$(aws ecs create-cluster --cluster-name $CLUSTER_NAME --query "cluster.clusterArn" --output text --region "$AWS_REGION")
  fi
  echo "✅ ECS Cluster available."
  end_step

else
  echo "⏭️  Skipping infrastructure setup (--skip-infra-setup)"
  EXECUTION_ROLE_ARN=$(aws iam get-role --role-name "$EXECUTION_ROLE_NAME" --query "Role.Arn" --output text --region "$AWS_REGION")
  TASK_ROLE_ARN=$(aws iam get-role --role-name "$TASK_ROLE_NAME" --query "Role.Arn" --output text --region "$AWS_REGION")
  SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$SECRETS_MANAGER_NAME" --query ARN --output text --region "$AWS_REGION")
  VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query "Vpcs[0].VpcId" --output text --region "$AWS_REGION")
  SUBNETS_LIST=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID --query "Subnets[*].SubnetId" --output text --region "$AWS_REGION")
  SUBNETS_ARRAY=($SUBNETS_LIST)
  ECS_SG_ID=$(aws ec2 describe-security-groups --filters Name=group-name,Values="${APP_NAME}-ecs-sg" Name=vpc-id,Values=$VPC_ID --query "SecurityGroups[0].GroupId" --output text --region "$AWS_REGION")
  TG_ARN=$(aws elbv2 describe-target-groups --names $TG_NAME --query "TargetGroups[0].TargetGroupArn" --output text --region "$AWS_REGION")
  ALB_DNS=$(aws elbv2 describe-load-balancers --names $ALB_NAME --query "LoadBalancers[0].DNSName" --output text --region "$AWS_REGION")
  CF_DOMAIN=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='CloudFront for ${APP_NAME}'].DomainName | [0]" --output text 2>/dev/null || echo "None")
fi

# 4. Register ECS Task Definition
start_step "Register ECS Task Definition"
ECR_URL="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
IMAGE_URI="${ECR_URL}/${ECR_REPO_NAME}:latest"
EXTERNAL_URL="https://$CF_DOMAIN"

TASK_DEF_FILE=$(mktemp)
cat > "$TASK_DEF_FILE" <<EOF
{
  "family": "$TASK_FAMILY",
  "networkMode": "awsvpc",
  "executionRoleArn": "$EXECUTION_ROLE_ARN",
  "taskRoleArn": "$TASK_ROLE_ARN",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "$APP_NAME",
      "image": "$IMAGE_URI",
      "portMappings": [
        {
          "containerPort": 3000,
          "hostPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "VERIFY_SSL", "value": "false" },
        { "name": "LOG_LEVEL", "value": "INFO" },
        { "name": "NEXT_PUBLIC_LANGGRAPH_URL", "value": "${NEXT_PUBLIC_LANGGRAPH_URL}" },
        { "name": "NEXT_PUBLIC_ASSISTANT_ID", "value": "${NEXT_PUBLIC_ASSISTANT_ID:-research}" },
        { "name": "AUTH_TRUST_HOST", "value": "true" },
        { "name": "AUTH_URL", "value": "${EXTERNAL_URL}" },
        { "name": "NEXTAUTH_URL", "value": "${EXTERNAL_URL}" },
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3000" }
      ],
      "secrets": [
        { "name": "UPLOAD_API_KEY", "valueFrom": "${SECRET_ARN}:UPLOAD-API-KEY::" },
        { "name": "NEXT_PUBLIC_LANGSMITH_API_KEY", "valueFrom": "${SECRET_ARN}:LANGCHAIN-API-KEY::" },
        { "name": "AUTH_SECRET", "valueFrom": "${SECRET_ARN}:AUTH-SECRET::" },
        { "name": "AUTH_GITHUB_ID", "valueFrom": "${SECRET_ARN}:AUTH-GITHUB-ID::" },
        { "name": "AUTH_GITHUB_SECRET", "valueFrom": "${SECRET_ARN}:AUTH-GITHUB-SECRET::" },
        { "name": "AUTH_GOOGLE_ID", "valueFrom": "${SECRET_ARN}:AUTH-GOOGLE-ID::" },
        { "name": "AUTH_GOOGLE_SECRET", "valueFrom": "${SECRET_ARN}:AUTH-GOOGLE-SECRET::" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "$LOG_GROUP_NAME",
          "awslogs-region": "$AWS_REGION",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
EOF

TASK_DEF_ARN=$(aws ecs register-task-definition --cli-input-json "file://$TASK_DEF_FILE" --query "taskDefinition.taskDefinitionArn" --output text --region "$AWS_REGION")
rm -f "$TASK_DEF_FILE"
echo "✅ Registered Task Definition: $TASK_DEF_ARN"
end_step

# 5. Create or Update ECS Service
start_step "Deploy ECS Service"
SERVICE_EXISTS=$(aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --query "services[0].status" --output text --region "$AWS_REGION" 2>/dev/null || echo "MISSING")

SUBNETS_STR=$(IFS=, ; echo "${SUBNETS_ARRAY[*]}")

if [ "$SERVICE_EXISTS" = "ACTIVE" ]; then
  echo "✨ Updating existing ECS Service..."
  aws ecs update-service \
    --cluster $CLUSTER_NAME \
    --service $SERVICE_NAME \
    --task-definition $TASK_DEF_ARN \
    --force-new-deployment \
    --region "$AWS_REGION" > /dev/null
else
  echo "✨ Creating new ECS Service..."
  aws ecs create-service \
    --cluster $CLUSTER_NAME \
    --service-name $SERVICE_NAME \
    --task-definition $TASK_DEF_ARN \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS_STR}],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=$APP_NAME,containerPort=3000" \
    --region "$AWS_REGION" > /dev/null
fi
echo "✅ Deployment triggered for ECS Service: $SERVICE_NAME"
end_step

# 6. Wait for Deployment to Settle
start_step "Wait for ECS Service Stability"
echo "⏳ Waiting for ECS service to reach steady state (takes ~3-5 mins)..."
aws ecs wait services-stable --cluster $CLUSTER_NAME --services $SERVICE_NAME --region "$AWS_REGION"
echo "✅ ECS Service is stable!"
end_step

echo ""
echo "═══════════════════════════════════════════════════════"
echo "✅ AWS ECS Fargate + ALB Deployment Complete!"
echo "═══════════════════════════════════════════════════════"
echo "🌐 Public UI Domain: https://$CF_DOMAIN"
echo "   (Note: CloudFront distributions can take up to 5 minutes to fully provision)"
echo "═══════════════════════════════════════════════════════"

# 7. Health verification
start_step "Health Check Verification"
echo "🔍 Testing UI endpoint..."
MAX_RETRIES=10
RETRY_INTERVAL=10
UI_RESPONDING=false
for i in $(seq 1 $MAX_RETRIES); do
  echo -n "   Attempt $i/$MAX_RETRIES... "
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://$CF_DOMAIN" 2>/dev/null || echo "")
  if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "302" ] || [ "$HTTP_STATUS" = "307" ] || [ "$HTTP_STATUS" = "403" ]; then
    echo "✅ UI is up and running! (HTTP Status: $HTTP_STATUS)"
    UI_RESPONDING=true
    break
  else
    echo "❌ Status: ${HTTP_STATUS:-No response}"
  fi
  if [ $i -lt $MAX_RETRIES ]; then
    echo "   Waiting ${RETRY_INTERVAL}s before next attempt..."
    sleep $RETRY_INTERVAL
  fi
done

if [ "$UI_RESPONDING" = false ]; then
  echo ""
  echo "⚠️  WARNING: Deployment completed but UI did not respond within the expected time."
else
  echo ""
  echo "✅ AWS Deployment verified successfully!"
fi
end_step

print_timing_summary
