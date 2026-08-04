# Documentation

Project documentation is grouped by subject. Start with active guides; use history
section when reviewing earlier design decisions or implementation context.

## Active guides

### Architecture

- [Clean architecture boundaries](architecture/clean-architecture.md) - dependency
  direction, feature ownership, composition roots, and enforcement.

### Authentication

- [Passkey authentication](authentication/passkey-authentication.md) - WebAuthn
  trust boundaries, enrollment, sign-in, management, endpoints, and persistence.

### Deployment

- [Azure App Service deployment](deployment/azure-app-service.md) - standalone ZIP
  deployment, Key Vault integration, health verification, and manual rollback.
- [AWS ECS Fargate deployment](deployment/aws-ecs-fargate.md) - ECR build, ECS/ALB/
  CloudFront deployment, known security risks, and recovery boundaries.
- [Oracle VM deployment](deployment/oracle-vm.md) - SSH-based deployment of an
  existing AMD64 image to a provisioned VM.
- [Vercel deployment](deployment/vercel.md) - Git import, environment configuration,
  deployment, and backend redirect updates.

## History

Historical documents record decisions and execution context at time they were
written. Commands and paths may no longer represent current repository state.

### Plans

- [Oracle AMD VM deployment implementation plan](history/plans/2026-07-27-oracle-amd-deployment.md)
- [Passkey authentication documentation implementation plan](history/plans/2026-08-03-passkey-authentication-documentation.md)
- [Documentation organization implementation plan](history/plans/2026-08-03-documentation-organization.md)
- [Cloud deployment guides implementation plan](history/plans/2026-08-04-cloud-deployment-guides.md)

### Specifications

- [Oracle AMD VM deployment design](history/specifications/2026-07-27-oracle-amd-deployment-design.md)
- [Passkey authentication documentation design](history/specifications/2026-08-03-passkey-authentication-documentation-design.md)
- [Documentation organization design](history/specifications/2026-08-03-documentation-organization-design.md)
- [Cloud deployment guides design](history/specifications/2026-08-03-cloud-deployment-guides-design.md)

## Maintenance

- Put current operational guidance in subject folder.
- Put dated plans and specifications under `history/`.
- Use relative links for repository documents.
- Update this index when adding, moving, or retiring a document.
- Preserve historically accurate commands and decisions; add note instead of
  rewriting history when current behavior differs.
