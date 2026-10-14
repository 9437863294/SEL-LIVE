'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AppWindow, Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiText } from '@/hooks/use-company-profile'
import { useDialogPreferences } from '@/components/theme/ThemeProvider'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * `sm` 24rem · `md` 32rem · `lg` 42rem · `xl` 64rem · `2xl` 80rem · `full` the viewport less a
 * margin. `xl`, `2xl`, `full` and `default` keep the widths they had before the scale was added,
 * because pages already pass them. Below `sm` every size is the screen less a small margin.
 */
type DialogContentSizes = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' | 'default'

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /**
   * A preset width (and height cap). When omitted, a dialog whose className sets no `max-w-*`
   * takes the user's own default dialog size (`html[data-user-dialog-size]`), else the company's
   * (`html[data-dialog-size]`, ui-design.css); with neither it keeps the original near-full-width
   * default.
   */
  size?: DialogContentSizes
  /**
   * Maximise / minimise buttons beside the ×. Defaults to the user's preference (My appearance ›
   * Dialogs, on unless they turned it off); pass `false` for a dialog where they make no sense.
   */
  windowControls?: boolean
  /** The label on the minimised bar. Defaults to the DialogTitle's text. */
  windowTitle?: string
}

const SIZE_CLASSES: Record<DialogContentSizes, string> = {
  sm: 'max-w-[95vw] sm:max-w-sm max-h-[90vh]',
  md: 'max-w-[95vw] sm:max-w-lg max-h-[90vh]',
  lg: 'max-w-[95vw] sm:max-w-2xl max-h-[90vh]',
  xl: 'max-w-[64rem] max-h-[90vh]',
  '2xl': 'max-w-[80rem] max-h-[92vh]',
  full: 'max-w-[98vw] sm:max-w-[1800px] max-h-[95vh]',
  default: 'max-w-[95vw] max-h-[85vh]',
}

/** Whether a className already sets a width cap, at any breakpoint. */
const HAS_MAX_W = /(^|\s|:)max-w-/

type WindowState = 'normal' | 'maximised' | 'minimised'

const WINDOW_BUTTON =
  'inline-flex h-6 w-6 items-center justify-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

// ── Minimised dialogs ────────────────────────────────────────────────────────────────────────
// A minimised dialog keeps its Radix content mounted (so its form state survives) but hidden and
// `inert`, and drops its overlay. While any is minimised <html data-dialog-minimised> lifts the
// pointer-events lock Radix puts on <body>. Their bars stack in one dock, bottom-right.

let minimisedCount = 0
function countMinimised(delta: 1 | -1) {
  minimisedCount = Math.max(0, minimisedCount + delta)
  if (minimisedCount > 0) document.documentElement.setAttribute('data-dialog-minimised', '')
  else document.documentElement.removeAttribute('data-dialog-minimised')
}

function dialogDock(): HTMLElement {
  let dock = document.getElementById('sel-dialog-dock')
  if (!dock) {
    dock = document.createElement('div')
    dock.id = 'sel-dialog-dock'
    dock.className = 'sel-dialog-dock'
    dock.setAttribute('role', 'region')
    dock.setAttribute('aria-label', 'Minimised dialogs')
    document.body.appendChild(dock)
  }
  return dock
}

/**
 * The bar a minimised dialog shows. It is rendered from inside the dialog's React tree (portalled
 * to the dock), so Radix's DismissableLayer counts a click on it as inside the dialog and its
 * DialogClose still closes that dialog.
 */
function MinimisedBar({ title, onRestore, closeLabel }: { title: string; onRestore: () => void; closeLabel: string }) {
  // Only ever rendered in the browser, after the user pressed Minimise.
  const [dock] = React.useState(dialogDock)
  const restoreRef = React.useRef<HTMLButtonElement>(null)

  React.useLayoutEffect(() => {
    countMinimised(1)
    restoreRef.current?.focus({ preventScroll: true })
    return () => countMinimised(-1)
  }, [])

  return createPortal(
    <div
      data-slot="dialog-minimised"
      role="group"
      aria-label={title}
      className="flex w-72 max-w-full items-center gap-1 rounded-lg border bg-background py-1.5 pl-3 pr-1.5 text-foreground shadow-lg"
    >
      <AppWindow className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
        {title}
      </span>
      <button ref={restoreRef} type="button" className={WINDOW_BUTTON} onClick={onRestore} aria-label={`Restore ${title}`} title="Restore">
        <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <DialogPrimitive.Close className={WINDOW_BUTTON} aria-label={`${closeLabel} ${title}`} title={closeLabel}>
        <X className="h-4 w-4" aria-hidden="true" />
      </DialogPrimitive.Close>
    </div>,
    dock
  )
}

/** Runs when the Radix content mounts (the dialog opened) and unmounts (it closed). */
function WindowLifecycle({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  const handlers = React.useRef({ onOpen, onClose })
  React.useLayoutEffect(() => {
    handlers.current = { onOpen, onClose }
  })
  React.useLayoutEffect(() => {
    handlers.current.onOpen()
    return () => handlers.current.onClose()
  }, [])
  return null
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size, windowControls, windowTitle, onEscapeKeyDown, onInteractOutside, onFocusCapture, ...props }, ref) => {
  const closeLabel = useUiText()('close', 'Close')
  const prefs = useDialogPreferences()
  const controls = windowControls ?? prefs.controls
  // Omitted size keeps the original default ('full'); `data-size="auto"` lets the user's or the
  // company's default dialog size replace it, but only when the page set no width of its own.
  const sizeClasses = SIZE_CLASSES[size ?? 'full']
  const dataSize = size ?? (typeof className === 'string' && HAS_MAX_W.test(className) ? 'custom' : 'auto')

  const [windowState, setWindowState] = React.useState<WindowState>('normal')
  const [barTitle, setBarTitle] = React.useState('')
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const lastFocus = React.useRef<HTMLElement | null>(null)
  const restoreTo = React.useRef<WindowState>('normal')
  const refocus = React.useRef(false)
  const minimised = windowState === 'minimised'
  const maximised = windowState === 'maximised'

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )

  const minimise = () => {
    const titleId = contentRef.current?.getAttribute('aria-labelledby')
    const titleText = titleId ? document.getElementById(titleId)?.textContent?.trim() : ''
    setBarTitle(windowTitle || titleText || 'Dialog')
    restoreTo.current = maximised ? 'maximised' : 'normal'
    setWindowState('minimised')
  }
  const restore = () => {
    refocus.current = true
    setWindowState(restoreTo.current)
  }

  // Back from the dock: focus returns to where it was in the dialog, else to the dialog itself,
  // and Radix's focus trap (which never stopped) holds it there again.
  React.useEffect(() => {
    if (minimised || !refocus.current) return
    refocus.current = false
    const target = lastFocus.current?.isConnected ? lastFocus.current : contentRef.current
    target?.focus({ preventScroll: true })
  }, [minimised])

  return (
    <DialogPortal>
      {!minimised && <DialogOverlay />}
      <DialogPrimitive.Content
        ref={setRefs}
        data-slot="dialog-content"
        data-size={dataSize}
        data-window={windowState}
        data-window-controls={controls ? 'on' : 'off'}
        inert={minimised}
        aria-describedby={undefined}
        className={cn(
          // Centering + animations
          'fixed left-1/2 top-1/2 z-50 translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg duration-200',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
          'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          // Layout: flex column so inner body can own scroll
          'w-full sm:rounded-lg overflow-hidden flex flex-col min-h-0',
          sizeClasses,
          // Padding on the shell (you can move p-6 into inner sections if you prefer edge-to-edge scrollbars)
          'p-6',
          className
        )}
        // Keep scrollbars from shifting layout when they appear
        style={{ scrollbarGutter: 'stable both-edges' }}
        // Minimised, the dialog ignores Escape and clicks on the page behind it.
        onEscapeKeyDown={(event) => {
          if (minimised) event.preventDefault()
          else onEscapeKeyDown?.(event)
        }}
        onInteractOutside={(event) => {
          if (minimised) event.preventDefault()
          else onInteractOutside?.(event)
        }}
        onFocusCapture={(event) => {
          const target = event.target as HTMLElement
          if (contentRef.current?.contains(target) && !target.closest('[data-slot="dialog-window-controls"]')) lastFocus.current = target
          onFocusCapture?.(event)
        }}
        {...props}
      >
        <WindowLifecycle
          onOpen={() => setWindowState(controls && prefs.openMaximised ? 'maximised' : 'normal')}
          onClose={() => {
            lastFocus.current = null
            setWindowState('normal')
          }}
        />
        {children}

        {controls && (
          <div data-slot="dialog-window-controls" className="absolute right-10 top-3 items-center gap-0.5">
            <button
              type="button"
              className={WINDOW_BUTTON}
              onClick={() => setWindowState(maximised ? 'normal' : 'maximised')}
              aria-label={maximised ? 'Restore size' : 'Maximise'}
              title={maximised ? 'Restore size' : 'Maximise'}
              aria-pressed={maximised}
            >
              {maximised ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
            <button type="button" className={WINDOW_BUTTON} onClick={minimise} aria-label="Minimise" title="Minimise">
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <DialogPrimitive.Close
          data-slot="dialog-close"
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          aria-label={closeLabel}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>

        {minimised && <MinimisedBar title={barTitle} onRestore={restore} closeLabel={closeLabel} />}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div data-slot="dialog-header" className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

/**
 * The scrolling middle of a dialog: between a fixed `DialogHeader` and a fixed `DialogFooter`, it
 * takes the remaining height (DialogContent is a capped flex column) and scrolls on its own.
 */
const DialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div data-slot="dialog-body" className={cn('-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-1', className)} {...props} />
)
DialogBody.displayName = 'DialogBody'

/**
 * Buttons stack full-width on a phone (primary on top) and sit in a row from `sm` up. It never
 * shrinks in a capped dialog, and pins to the bottom when placed inside a `DialogBody`. The
 * company's footer alignment (ui-design.css) applies unless the className sets `justify-*`.
 */
const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-footer"
    data-align={typeof className === 'string' && /(^|\s|:)justify-/.test(className) ? 'custom' : undefined}
    className={cn('flex shrink-0 flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
