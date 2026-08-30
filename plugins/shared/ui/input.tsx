import type * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "./cn.ts"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn("dsh-studio-ui-input", className)}
      {...props}
    />
  )
}

export { Input }
