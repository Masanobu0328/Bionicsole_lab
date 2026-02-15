import * as React from "react"
import { cn } from "@/lib/utils"

const Toggle = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    pressed?: boolean
    onPressedChange?: (pressed: boolean) => void
  }
>(({ className, pressed, onPressedChange, onClick, ...props }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      data-state={pressed ? "on" : "off"}
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        "h-9 px-3",
        pressed && "bg-accent text-accent-foreground",
        className
      )}
      onClick={(e) => {
        onClick?.(e)
        onPressedChange?.(!pressed)
      }}
      {...props}
    />
  )
})

Toggle.displayName = "Toggle"

export { Toggle }
