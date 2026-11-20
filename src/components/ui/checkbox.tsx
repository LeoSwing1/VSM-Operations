import React from "react";

export function Checkbox({
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
      <span className="relative inline-flex items-center rounded border-2 border-muted w-5 h-5 bg-muted transition-colors duration-200 ease-in-out hover:border-volt/30">
        <span className="absolute inset-0 rounded-b-md bg-volt transform opacity-0 transition-opacity duration-200 ease-in-out checked:opacity-100 checked:translate-x-4"/>
      </span>
    </div>
  );
}