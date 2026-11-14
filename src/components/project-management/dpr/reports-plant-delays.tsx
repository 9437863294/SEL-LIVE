"use client";

/**
 * Plant and Delays, from the user's mock-up (`sel-dpr-reports-colour`).
 *
 * Plant: one card, its count in a pill; with nothing recorded, the empty state and the three steps
 * that fill it; otherwise each machine with its utilisation as a meter (the bar's colour backs the
 * percentage written beside it, never replaces it).
 *
 * Delays: lost time and hindrances as two figures, then a card each; with nothing raised, an
 * "All clear" state — no time lost is good news, and reads as such.
 */

import { AlertTriangle, Clock, Truck } from "lucide-react";
import type {
  DprEquipmentSummaryRow,
  DprHindranceRow,
  DprLostTimeRow,
  DprScope,
} from "@/lib/project-management-dpr";
import { formatDisplayDate, formatPct, formatQty } from "@/components/project-management/dpr/dpr-shell";
import {
  DprFigureRow,
  DprFigureTile,
  DprReportCard,
  DprReportPill,
  DprReportZero,
} from "@/components/project-management/dpr/reports-parts";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const TABLE_PROPS = { stickyHeader: true, containerClassName: "max-h-[65vh]" } as const;
const lineCell = "truncate text-sm";
const numberCell = "truncate text-right text-sm tabular-nums";
const scopeTone = (scope: DprScope) => (scope === "Civil" ? "info" : "progress");

const PLANT = ["#fcd34d", "#d97706"] as const;
const LOST = ["#fda4af", "#e11d48"] as const;
const HINDRANCE = ["#fdba74", "#ea580c"] as const;

/* ── Plant ──────────────────────────────────────────────────────────────────────────────────── */

export function DprPlantView({ rows, subtitle }: { rows: readonly DprEquipmentSummaryRow[]; subtitle: string }) {
  return (
    <DprReportCard
      icon={Truck}
      colours={PLANT}
      title="Plant & equipment"
      subtitle={subtitle}
      aside={<DprReportPill tone="warning">{rows.length} recorded</DprReportPill>}
    >
      {rows.length === 0 ? (
        <DprReportZero
          icon={Truck}
          colours={PLANT}
          glow={["rgba(253, 230, 138, 0.7)", "rgba(254, 215, 170, 0.7)"]}
          title="No plant recorded"
          text="Equipment deployed on the daily sheets rolls up here with its utilisation."
          steps={[
            { text: "Record equipment on the daily sheet", colours: ["rgba(245, 158, 11, 0.1)", "rgba(245, 158, 11, 0.35)", "#f59e0b"] },
            { text: "It rolls up here for the period and scope", colours: ["rgba(234, 88, 12, 0.1)", "rgba(234, 88, 12, 0.35)", "#ea580c"] },
            { text: "See utilisation for each machine", colours: ["rgba(220, 38, 38, 0.1)", "rgba(220, 38, 38, 0.35)", "#dc2626"] },
          ]}
        />
      ) : (
        <Table {...TABLE_PROPS} className="min-w-[700px] table-fixed">
          <colgroup>
            <col />
            <col className="w-[96px]" />
            <col className="w-[120px]" />
            <col className="w-[104px]" />
            <col className="w-[200px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="truncate">Equipment</TableHead>
              <TableHead className="truncate text-right" title="Days deployed">
                Days
              </TableHead>
              <TableHead className="truncate text-right" title="Running hours">
                Running hrs
              </TableHead>
              <TableHead className="truncate text-right" title="Idle hours">
                Idle hrs
              </TableHead>
              <TableHead className="truncate" title="Running ÷ (running + idle)">
                Utilisation
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell
                  className={`${lineCell} font-bold`}
                  style={{ boxShadow: `inset 3px 0 0 ${PLANT[1]}` }}
                  title={row.name}
                >
                  {row.name}
                </TableCell>
                <TableCell className={numberCell}>{row.deployedDays}</TableCell>
                <TableCell className={numberCell}>{formatQty(row.runningHours)}</TableCell>
                <TableCell className={numberCell}>{formatQty(row.idleHours)}</TableCell>
                <TableCell>
                  <UtilisationMeter value={row.utilisationPct} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DprReportCard>
  );
}

/** Running share of logged hours: a bar on a track of its own ramp, the figure beside it. */
function UtilisationMeter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-sm text-muted-foreground">No hours logged</span>;
  const tone =
    value >= 75
      ? { bar: "bg-emerald-500", track: "bg-emerald-100", word: "Good" }
      : value >= 50
        ? { bar: "bg-amber-500", track: "bg-amber-100", word: "Fair" }
        : { bar: "bg-rose-500", track: "bg-rose-100", word: "Low" };
  return (
    <span className="flex items-center gap-2" title={`${formatPct(value)} — ${tone.word.toLowerCase()} utilisation`}>
      <span className={cn("h-2 min-w-0 flex-1 overflow-hidden rounded-full", tone.track)}>
        <span className={cn("block h-full rounded-full", tone.bar)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </span>
      <b className="w-12 shrink-0 text-right text-sm font-extrabold tabular-nums">{formatPct(value)}</b>
      <span className="w-9 shrink-0 text-xs font-semibold text-muted-foreground">{tone.word}</span>
    </span>
  );
}

/* ── Delays ─────────────────────────────────────────────────────────────────────────────────── */

export function DprDelaysView({
  lostTime,
  hindrances,
  periodNoun,
}: {
  lostTime: readonly DprLostTimeRow[];
  hindrances: readonly DprHindranceRow[];
  periodNoun: string;
}) {
  const hours = lostTime.reduce((sum, row) => sum + row.hours, 0);
  const days = hindrances.length;
  return (
    <div className="space-y-4">
      <DprFigureRow columns={2}>
        <DprFigureTile
          icon={Clock}
          colours={LOST}
          label="Lost time"
          alert={hours > 0 ? "warning" : undefined}
          value={
            <>
              {formatQty(hours)} <span className="text-sm">hrs</span>
            </>
          }
          detail={hours > 0 ? `on ${lostTime.length} day${lostTime.length === 1 ? "" : "s"} this ${periodNoun}` : `in this ${periodNoun}`}
        />
        <DprFigureTile
          icon={AlertTriangle}
          colours={HINDRANCE}
          label="Hindrances"
          alert={days > 0 ? "warning" : undefined}
          value={
            <>
              {days} <span className="text-sm">day{days === 1 ? "" : "s"}</span>
            </>
          }
          detail={`in this ${periodNoun}`}
        />
      </DprFigureRow>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <DprReportCard
          icon={Clock}
          colours={LOST}
          title="Lost time"
          subtitle="For the selected period and scope"
          aside={<DprReportPill tone="danger">{formatQty(hours)} hrs</DprReportPill>}
        >
          {lostTime.length === 0 ? (
            <DprReportZero
              icon={Clock}
              colours={LOST}
              glow={["rgba(254, 205, 211, 0.75)", "rgba(251, 207, 232, 0.7)"]}
              title="No time lost in this period"
              clear="All clear"
            />
          ) : (
            <Table {...TABLE_PROPS} className="min-w-[560px] table-fixed">
              <colgroup>
                <col className="w-[136px]" />
                <col className="w-[96px]" />
                <col className="w-[72px]" />
                <col className="w-[104px]" />
                <col />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="truncate">Date</TableHead>
                  <TableHead className="truncate">Scope</TableHead>
                  <TableHead className="truncate text-right">Hours</TableHead>
                  <TableHead className="truncate">Weather</TableHead>
                  <TableHead className="truncate">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lostTime.map((row) => (
                  <TableRow key={`${row.date}-${row.scope}`}>
                    <TableCell className={`${lineCell} tabular-nums`} style={{ boxShadow: `inset 3px 0 0 ${LOST[1]}` }}>
                      {formatDisplayDate(row.date)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <StatusBadge status={row.scope} tone={scopeTone(row.scope)} />
                    </TableCell>
                    <TableCell className={`${numberCell} font-extrabold`}>{formatQty(row.hours)}</TableCell>
                    <TableCell className={lineCell} title={row.weather || undefined}>
                      {row.weather || "—"}
                    </TableCell>
                    <TableCell className={lineCell} title={row.reason || undefined}>
                      {row.reason || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DprReportCard>

        <DprReportCard
          icon={AlertTriangle}
          colours={HINDRANCE}
          title="Hindrances"
          subtitle="For the selected period and scope"
          aside={<DprReportPill tone="warning">{days} day{days === 1 ? "" : "s"}</DprReportPill>}
        >
          {hindrances.length === 0 ? (
            <DprReportZero
              icon={AlertTriangle}
              colours={HINDRANCE}
              glow={["rgba(254, 215, 170, 0.75)", "rgba(253, 230, 138, 0.7)"]}
              title="No hindrances raised in this period"
              clear="All clear"
            />
          ) : (
            <Table {...TABLE_PROPS} className="min-w-[480px] table-fixed">
              <colgroup>
                <col className="w-[136px]" />
                <col className="w-[96px]" />
                <col />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="truncate">Date</TableHead>
                  <TableHead className="truncate">Scope</TableHead>
                  <TableHead className="truncate">Hindrance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hindrances.map((row) => (
                  <TableRow key={`${row.date}-${row.scope}`}>
                    <TableCell className={`${lineCell} tabular-nums`} style={{ boxShadow: `inset 3px 0 0 ${HINDRANCE[1]}` }}>
                      {formatDisplayDate(row.date)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <StatusBadge status={row.scope} tone={scopeTone(row.scope)} />
                    </TableCell>
                    {/* One line: line breaks in the text read as separators; all of it on hover. */}
                    <TableCell className={`${lineCell} text-muted-foreground`} title={row.hindrances}>
                      {row.hindrances.replace(/\s*\n+\s*/g, " · ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DprReportCard>
      </div>
    </div>
  );
}
