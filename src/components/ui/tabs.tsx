import React from "react";

export interface TabsProps {
  defaultValue?: string;
  className?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
}

export interface TabsListProps {
  className?: string;
}

export interface TabsTriggerProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

export interface TabsContentProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

export function Tabs({ defaultValue = "", className, value, onValueChange, children }: TabsProps) {
  return <div className={className}>{children}</div>;
}

export function TabsList({ className }: TabsListProps) {
  return <ul className={className} role="tablist" aria-orientation="horizontal" />;
}

export function TabsTrigger({ value, className, children, onClick }: TabsTriggerProps & { onClick?: () => void }) {
  return (
    <li>
      <button
        role="tab"
        aria-controls={`tab-panel-${value}`}
        aria-selected={false}
        className={className}
        onClick={onClick}
      >
        {children}
      </button>
    </li>
  );
}

export function TabsContent({ value, className, children }: TabsContentProps) {
  return (
    <div
      role="tabpanel"
      aria-labelledby={`tab-trigger-${value}`}
      className={className}
    >
      {children}
    </div>
  );
}