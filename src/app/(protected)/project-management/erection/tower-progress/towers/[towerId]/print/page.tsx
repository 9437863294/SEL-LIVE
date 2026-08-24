"use client";

/**
 * The formal per-tower report (§16) — the document that goes into a file or to a client for one
 * tower: its details, its seven activities, and the photograph backing each of them.
 *
 * Rendered on a `/print` route so the application shell is out of the way and this is a real A4
 * sheet. The photographs carry the project watermark, so a page that leaves this system still says
 * which company, project, tower, activity, date and coordinates it belongs to.
 */

import { useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TOWER_ACTIVITY_LIST,
  formatGps,
  formatKm,
  formatTowerDate,
  hasCompleteEvidence,
  isActivityComplete,
  toDateKey,
} from "@/lib/project-management-tower-progress";
import {
  buildTowerTimeline,
  selectReportPhoto,
} from "@/lib/project-management-tower-reports";
import { useTowerProgress } from "@/components/project-management/tower-progress/tower-progress-provider";
import {
  MissingPhotoPlate,
  TowerReportPhoto,
} from "@/components/project-management/tower-progress/tower-progress-ui";

export default function TowerReportPrintPage() {
  const params = useParams();
  const towerId = String(params?.towerId ?? "");
  const { project, updates, settings, isLoading, permissions, towerById } = useTowerProgress();
  const tower = towerById(towerId);
  const hasPrinted = useRef(false);

  const activities = useMemo(() => {
    if (!tower) return [];
    return TOWER_ACTIVITY_LIST.map((definition) => {
      const state = tower.activities[definition.key];
      return {
        definition,
        state,
        evidenceComplete: hasCompleteEvidence(definition.key, state),
        photo: selectReportPhoto(updates, tower.id, definition.key, {
          requireApproved: settings.clientReportsRequireApprovedPhotos,
        }),
      };
    });
  }, [tower, updates, settings.clientReportsRequireApprovedPhotos]);

  const timeline = useMemo(
    () => (tower ? buildTowerTimeline(updates, tower.id) : []),
    [updates, tower],
  );

  // Delayed so the photographs have loaded — printing early yields grey boxes where the evidence
  // should be, which is worse than not printing at all.
  useEffect(() => {
    if (isLoading || !tower || hasPrinted.current || !permissions.viewReports) return;
    hasPrinted.current = true;
    const timer = setTimeout(() => {
      if (typeof window !== "undefined") window.print();
    }, 1500);
    return () => clearTimeout(timer);
  }, [isLoading, tower, permissions.viewReports]);

  if (!permissions.viewReports) {
    return <div className="p-8 text-sm">You do not have permission to view this report.</div>;
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-[80vh]" />
      </div>
    );
  }

  if (!tower) {
    return <div className="p-8 text-sm">This tower is not in the project register.</div>;
  }

  const lastEntry = timeline[timeline.length - 1];
  const verifiers = Array.from(
    new Set(timeline.map((entry) => entry.verifiedByName).filter(Boolean)),
  );

  return (
    <>
      <PrintStyles />
      <div className="bg-white">
        <div className="flex justify-end p-3 print:hidden">
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>

        <div id="printable-sheet" className="mx-auto max-w-[900px] px-6 pb-10 print:px-0">
          <header className="border-b-2 border-black pb-2 text-center">
            <p className="text-[10pt] font-bold uppercase tracking-widest">
              {settings.watermarkOrganisation}
            </p>
            <h1 className="mt-1 text-lg font-extrabold uppercase">
              Transmission Line Tower Progress Report
            </h1>
          </header>

          <section className="mt-3 border border-black text-[9pt]">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 p-2">
              <Detail label="Project" value={project?.projectName || "—"} />
              <Detail label="Tower number" value={tower.towerNo} />
              <Detail label="Tower type" value={tower.towerType || "—"} />
              <Detail label="Section" value={tower.section || "—"} />
              <Detail label="Location" value={tower.location || "—"} />
              <Detail
                label="GPS"
                value={
                  tower.latitude !== undefined && tower.longitude !== undefined
                    ? formatGps({ latitude: tower.latitude, longitude: tower.longitude })
                    : "—"
                }
              />
              <Detail label="Contractor" value={tower.contractor || "—"} />
              <Detail
                label="Span to next tower"
                value={tower.spanToNextM ? `${tower.spanToNextM} m` : "—"}
              />
            </dl>
          </section>

          <section className="mt-4">
            <h2 className="mb-1 text-[10pt] font-bold uppercase">Activity status</h2>
            <table className="w-full border border-black text-[9pt]">
              <thead>
                <tr>
                  <th className="border border-black px-1.5 py-1 text-left">Activity</th>
                  <th className="border border-black px-1.5 py-1 text-left">Status</th>
                  <th className="border border-black px-1.5 py-1 text-left">Started</th>
                  <th className="border border-black px-1.5 py-1 text-left">Completed</th>
                  <th className="border border-black px-1.5 py-1 text-center">Evidence</th>
                  <th className="border border-black px-1.5 py-1 text-left">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {activities.map(({ definition, state, evidenceComplete }) => (
                  <tr key={definition.key}>
                    <td className="border border-black px-1.5 py-1 font-semibold uppercase">
                      {definition.label}
                    </td>
                    <td className="border border-black px-1.5 py-1 uppercase">
                      {state.status}
                      {definition.measure === "span" && state.quantityM
                        ? ` · ${formatKm(state.quantityM)}`
                        : ""}
                    </td>
                    <td className="border border-black px-1.5 py-1">
                      {formatTowerDate(state.startedDate)}
                    </td>
                    <td className="border border-black px-1.5 py-1">
                      {formatTowerDate(state.completedDate)}
                    </td>
                    <td className="border border-black px-1.5 py-1 text-center">
                      {isActivityComplete(state.status)
                        ? evidenceComplete
                          ? "✓"
                          : "MISSING"
                        : "—"}
                    </td>
                    <td className="border border-black px-1.5 py-1">
                      {state.reason || state.remarks || "—"}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} className="border border-black px-1.5 py-1 text-right font-bold">
                    Overall progress
                  </td>
                  <td colSpan={2} className="border border-black px-1.5 py-1 font-bold">
                    {tower.overallProgressPct}%
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="mt-4">
            <h2 className="mb-2 text-[10pt] font-bold uppercase">Photographs</h2>
            <div className="grid grid-cols-2 gap-3">
              {activities.map(({ definition, photo }) => (
                <div key={definition.key} className="break-inside-avoid space-y-1">
                  <p className="text-[9pt] font-semibold uppercase">{definition.label}</p>
                  {photo ? (
                    <TowerReportPhoto
                      url={photo.photo.url}
                      towerNo={tower.towerNo}
                      activity={definition.key}
                      progressDate={photo.progressDate}
                      gps={photo.photo.gps}
                      uploadedByName={photo.uploadedByName}
                      verified={photo.verified}
                    />
                  ) : (
                    <MissingPhotoPlate label={definition.label} />
                  )}
                </div>
              ))}
            </div>
            {settings.clientReportsRequireApprovedPhotos ? (
              <p className="mt-2 text-[8pt] text-neutral-600">
                Only verified photographs appear on this sheet. An activity showing no photograph
                either has none recorded, or has photographs still awaiting verification.
              </p>
            ) : null}
          </section>

          <section className="mt-5 break-inside-avoid border-t border-black pt-2 text-[9pt]">
            <div className="grid grid-cols-3 gap-4">
              <p>
                <strong>Last updated:</strong>{" "}
                {lastEntry ? formatTowerDate(lastEntry.progressDate) : "—"}
              </p>
              <p>
                <strong>Updated by:</strong> {lastEntry?.uploadedByName || "—"}
              </p>
              <p>
                <strong>Verified by:</strong> {verifiers.join(", ") || "—"}
              </p>
            </div>
            <div className="mt-10 flex justify-between">
              <span className="w-1/3 border-t border-black pt-1 text-center">Site Engineer</span>
              <span className="w-1/3 border-t border-black pt-1 text-center">Site In-charge</span>
              <span className="w-1/3 border-t border-black pt-1 text-center">Project Manager</span>
            </div>
            <p className="mt-3 text-[8pt] text-neutral-600">
              Generated {formatTowerDate(toDateKey(new Date()))} from recorded site data and
              photographic evidence. {timeline.length} progress update
              {timeline.length === 1 ? "" : "s"} on record for this tower.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="font-semibold">{label}:</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PrintStyles() {
  return (
    <style>{`
      @media print {
        @page { size: A4 portrait; margin: 12mm 10mm; }
        html, body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          margin: 0;
          padding: 0;
          background: #fff !important;
        }
        #printable-sheet { max-width: none !important; }
        thead { display: table-header-group; }
        tr, section, figure, .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
        img { max-width: 100%; }
      }
    `}</style>
  );
}
