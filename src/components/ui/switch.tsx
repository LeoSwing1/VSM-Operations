import React from "react";

export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <div className={className} {...props}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        className="hidden"
      />
      <span className="relative inline-flex items-center rounded-md border w-6 h-4 bg-muted p-1 transition-colors duration-200 ease-in-out hover:border-volt/30">
        <span className="absolute left-0.5 top-0.5 w-2 h-2 rounded-full bg-volt shadow transform transition-transform checked:translate-x-3"/>
      </span>
    </div>
  );
}