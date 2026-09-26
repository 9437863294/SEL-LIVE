"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

type IndicatorBox = { x: number; y: number; width: number; height: number; radius: string }

/**
 * Where `tab` sits inside `list`'s scrolled content box, to the sub-pixel: `flex-1` tabs have
 * fractional widths, which the integer offsetLeft/offsetWidth would round off by a pixel.
 *
 * Two transforms must not leak into the measurement. A tab is measured the moment it activates —
 * on mousedown, while its own press effect has it scaled to 97% — so its size comes from the
 * computed (layout) width and only its centre from the screen rect, which a scale about the centre
 * leaves in place. And a strip inside a dialog that is still zooming in is scaled as a whole, so
 * screen distances are divided by the list's own scale. The scroll offset is added back so a
 * scrolled strip's indicator stays under its tab.
 */
function boxWithin(tab: HTMLElement, list: HTMLElement): IndicatorBox | null {
  if (!tab.offsetWidth || !list.offsetWidth) return null
  const listRect = list.getBoundingClientRect()
  const tabRect = tab.getBoundingClientRect()
  const style = window.getComputedStyle(tab)
  const width = parseFloat(style.width) || tab.offsetWidth
  const height = parseFloat(style.height) || tab.offsetHeight
  const scaleX = listRect.width / list.offsetWidth || 1
  const scaleY = listRect.height / list.offsetHeight || 1
  const centreX = (tabRect.left + tabRect.width / 2 - listRect.left) / scaleX - list.clientLeft + list.scrollLeft
  const centreY = (tabRect.top + tabRect.height / 2 - listRect.top) / scaleY - list.clientTop + list.scrollTop
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    x: round(centreX - width / 2),
    y: round(centreY - height / 2),
    width: round(width),
    height: round(height),
    radius: style.borderRadius,
  }
}

function sameBox(a: IndicatorBox | null, b: IndicatorBox | null) {
  return (
    a === b ||
    (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.radius === b.radius)
  )
}

/**
 * A tab strip with an animated indicator: a pill in the app's accent (Settings → Appearance) that
 * slides to whichever tab is active — across a wrapped second row or a scrolled strip too.
 *
 * The indicator follows Radix's own `data-state`, so it works however the tabs are driven
 * (controlled, uncontrolled, keyboard). Until it has measured — the server render, the first
 * frame — the active tab paints the same pill itself, so there is no flash of the old style.
 * `indicator={false}` opts a strip back into the plain look.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { indicator?: boolean }
>(({ className, children, indicator = true, ...props }, forwardedRef) => {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [box, setBox] = React.useState<IndicatorBox | null>(null)
  const [animate, setAnimate] = React.useState(false)

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node
      if (typeof forwardedRef === "function") forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef]
  )

  useIsoLayoutEffect(() => {
    const list = listRef.current
    if (!list || !indicator) return
    let frame = 0
    const resize = new ResizeObserver(() => schedule())

    const measure = () => {
      frame = 0
      const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter(
        (tab) => tab.closest('[role="tablist"]') === list
      )
      tabs.forEach((tab) => resize.observe(tab))
      const active = tabs.find((tab) => tab.getAttribute("data-state") === "active")
      const next = active ? boxWithin(active, list) : null
      setBox((previous) => (sameBox(previous, next) ? previous : next))
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }

    measure()
    resize.observe(list)
    const mutations = new MutationObserver(schedule)
    mutations.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
    }
  }, [indicator])

  // The first placement jumps into position; only moves after that slide.
  const placed = box !== null
  React.useEffect(() => {
    if (!placed || animate) return
    const frame = window.requestAnimationFrame(() => setAnimate(true))
    return () => window.cancelAnimationFrame(frame)
  }, [placed, animate])

  return (
    <TabsPrimitive.List
      ref={setRefs}
      data-indicator={!indicator ? "off" : placed ? "on" : "pending"}
      className={cn(
        "group/tabs relative inline-flex h-10 items-center justify-center rounded-xl bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      {indicator && box && (
        <span
          aria-hidden="true"
          className="tabs-indicator"
          data-animate={animate ? "true" : "false"}
          // Inline so a strip's own `space-x-*` / `divide-*` rules, aimed at the tabs, cannot shift it.
          style={{
            width: box.width,
            height: box.height,
            transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
            borderRadius: box.radius,
            margin: 0,
            border: 0,
          }}
        />
      )}
    </TabsPrimitive.List>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative z-[1] inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ring-offset-background transition-[color,background-color,box-shadow,transform] duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground",
      // Indicator measured: it paints the pill, the tab only switches its label to the on-accent
      // colour — a beat late, as the pill arrives, or the white label vanishes against the track.
      "group-data-[indicator=on]/tabs:data-[state=active]:text-[color:var(--sel-tab-on)] group-data-[indicator=on]/tabs:data-[state=active]:delay-150",
      // Not measured yet: the tab paints the same pill itself, so the swap-over is invisible.
      "group-data-[indicator=pending]/tabs:data-[state=active]:bg-[image:var(--sel-tab-gradient)] group-data-[indicator=pending]/tabs:data-[state=active]:text-[color:var(--sel-tab-on)] group-data-[indicator=pending]/tabs:data-[state=active]:shadow-[0_6px_16px_-6px_var(--sel-tab-glow)]",
      // Opted out: the original quiet style.
      "group-data-[indicator=off]/tabs:data-[state=active]:bg-background group-data-[indicator=off]/tabs:data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "tabs-content mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
