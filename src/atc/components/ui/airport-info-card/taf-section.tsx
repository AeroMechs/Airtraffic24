"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { TafData } from "./types";

type Props = {
  taf: TafData | null;
  loading: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  alwaysVisible?: boolean;
};

export function TafSection({
  taf,
  loading,
  expanded: controlledExpanded,
  onExpandedChange,
  alwaysVisible = false,
}: Props) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  if (!alwaysVisible && !loading && !taf) return null;

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    if (onExpandedChange) {
      onExpandedChange(nextExpanded);
      return;
    }
    setInternalExpanded(nextExpanded);
  };

  return (
    <div>
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center gap-1.5 rounded-md py-1 transition-colors hover:bg-foreground/3"
        aria-expanded={expanded}
        aria-controls="airport-taf-raw"
      >
        <FileText className="h-3 w-3 text-foreground/25" />
        <span className="text-[10px] font-medium tracking-widest text-foreground/25 uppercase">
          Forecast (TAF)
        </span>
        {loading && !taf && (
          <Loader2 className="ml-auto h-3 w-3 animate-spin text-foreground/20" />
        )}
        {taf && !loading && (
          <span className="ml-auto text-[9px] text-foreground/30">
            {expanded ? "Hide" : "Show"}
          </span>
        )}
        {!loading && !taf && expanded && (
          <span className="ml-auto text-[9px] text-foreground/25">
            Unavailable
          </span>
        )}
      </button>
      {taf?.rawTAF && expanded && (
        <div
          id="airport-taf-raw"
          className="mt-1 rounded-lg bg-foreground/3 px-2.5 py-2 ring-1 ring-foreground/4"
        >
          <p className="font-mono text-[9px] leading-relaxed whitespace-pre-wrap text-foreground/45 break-all select-all">
            {taf.rawTAF}
          </p>
        </div>
      )}
    </div>
  );
}
