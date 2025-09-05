
"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

const Timeline = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("relative flex flex-col", className)}
        {...props}
    >
        {children}
    </div>
))
Timeline.displayName = "Timeline"

export { Timeline }
