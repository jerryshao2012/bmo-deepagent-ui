"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { VariantProps } from "class-variance-authority";

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "panelHeader" | "transparent";
}

export function Toolbar({
  className,
  variant = "default",
  children,
  ...props
}: ToolbarProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-border text-sm select-none transition-colors",
        variant === "default" && "bg-muted/30 px-4 py-2",
        variant === "panelHeader" && "bg-background/95 backdrop-blur-md px-4 py-3",
        variant === "transparent" && "bg-transparent px-3 py-1.5 border-b-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ToolbarGroup({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-1.5 min-w-0", className)} {...props}>
      {children}
    </div>
  );
}

export interface ToolbarButtonProps
  extends React.ComponentProps<typeof Button> {
  tooltip?: string;
  tooltipSide?: "top" | "bottom" | "left" | "right";
  isIconOnly?: boolean;
}

export function ToolbarButton({
  tooltip,
  tooltipSide = "bottom",
  isIconOnly,
  className,
  variant = "ghost",
  size = "sm",
  children,
  ...props
}: ToolbarButtonProps) {
  const hasTextChild = React.Children.toArray(children).some(
    (child) => typeof child === "string" || typeof child === "number"
  );
  
  const autoIconOnly = isIconOnly !== undefined ? isIconOnly : !hasTextChild;

  const btn = (
    <Button
      variant={variant}
      size={size}
      className={cn(
        "h-7 text-xs font-medium transition-colors",
        autoIconOnly || size === "icon"
          ? "w-7 p-0 flex shrink-0 items-center justify-center"
          : "px-2.5 gap-1.5 inline-flex shrink-0 items-center justify-center",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  );

  if (tooltip) {
    return (
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return btn;
}

export function ToolbarSeparator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("h-4 w-px bg-border/70 mx-1 shrink-0", className)}
      {...props}
    />
  );
}

export function ToolbarLabel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("text-xs text-muted-foreground font-medium shrink-0", className)}
      {...props}
    >
      {children}
    </span>
  );
}

export interface WindowControlDotsProps {
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  className?: string;
}

export function WindowControlDots({
  onClose,
  onMinimize,
  onMaximize,
  className,
}: WindowControlDotsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-[6px] mr-2 shrink-0 group/dots py-1 px-1",
        className
      )}
    >
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            onClick={onClose}
            className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#FF5F56] border border-[#E0443E] active:bg-[#BF403A] focus:outline-none transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg
              className="absolute h-[5px] w-[5px] text-[#4C0002] opacity-0 transition-opacity duration-150 group-hover/dots:opacity-100"
              viewBox="0 0 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            >
              <path d="M1 1l4 4M5 1L1 5" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Close</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            onClick={onMinimize}
            className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#FFBD2E] border border-[#DFA023] active:bg-[#C08E1A] focus:outline-none transition-colors cursor-pointer"
            aria-label="Minimize"
          >
            <svg
              className="absolute h-[5px] w-[5px] text-[#5C3E00] opacity-0 transition-opacity duration-150 group-hover/dots:opacity-100"
              viewBox="0 0 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            >
              <path d="M1 3h4" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Minimize</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            onClick={onMaximize}
            className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#27C93F] border border-[#1AAB29] active:bg-[#158C20] focus:outline-none transition-colors cursor-pointer"
            aria-label="Toggle Fullscreen"
          >
            <svg
              className="absolute h-[5px] w-[5px] text-[#004D00] opacity-0 transition-opacity duration-150 group-hover/dots:opacity-100"
              viewBox="0 0 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            >
              <path d="M1 2v3h3M5 4V1H2" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Fullscreen</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
