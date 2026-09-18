'use client';

/**
 * The module's error boundary (§2, §56).
 *
 * A class component because that is still the only way to catch a render error in React — hooks
 * have no equivalent of `componentDidCatch`, and Next's `error.tsx` catches at the route level,
 * which unmounts the nav along with the broken screen.
 *
 * What it shows matters as much as that it catches: §56 says never to put a stack trace in front of
 * an ordinary user, so the message is a sentence about what happened and what to do, the technical
 * detail goes to the console for whoever is debugging, and there is a "Try again" that re-mounts the
 * subtree rather than reloading the page — most of these failures are a bad render against
 * half-loaded data, and a re-mount fixes them.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { OFFICE_HUB_BASE_PATH } from '@/lib/office-hub';

interface Props {
  children: ReactNode;
  /** Names the screen in the message, e.g. "the meeting register". */
  what?: string;
}

interface State {
  error: Error | null;
  /** Bumped on retry, and used as the subtree's key so it genuinely re-mounts. */
  attempt: number;
}

export class OfficeHubErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[office-hub] Render error', error, info.componentStack);
  }

  private retry = (): void => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }));
  };

  render(): ReactNode {
    const { error, attempt } = this.state;
    if (!error) {
      // Keyed so that retrying discards the subtree's state rather than re-running the same broken
      // render against the same props.
      return <div key={attempt}>{this.props.children}</div>;
    }

    return (
      <Card className="border-rose-200 bg-white/80">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <AlertTriangle className="h-10 w-10 text-rose-500" />
          <div>
            <p className="font-semibold text-slate-800">
              Something went wrong loading {this.props.what ?? 'this screen'}
            </p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Nothing was saved or changed. Try again, and if it keeps happening tell your
              administrator what you were doing.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={this.retry} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Try again
            </Button>
            <Button variant="outline" asChild>
              <Link href={OFFICE_HUB_BASE_PATH}>Back to dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
}
