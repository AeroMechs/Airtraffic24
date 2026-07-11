"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Camera } from "lucide-react";
import type { NormalizedPhoto } from "@/atc/hooks/use-aircraft-photos";

type HeroBannerProps = {
  photo: NormalizedPhoto | null;
  loading: boolean;
};

const FULL_RESOLUTION_DELAY_MS = 1_000;
const FULL_RESOLUTION_IDLE_TIMEOUT_MS = 800;

type HeroSources = {
  preview: string | null;
  fullResolution: string | null;
};

type HeroMediaProps = {
  sources: HeroSources;
  photographer: string | null;
  loading: boolean;
};

function HeroMedia({ sources, photographer, loading }: HeroMediaProps) {
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [allowFullResolution, setAllowFullResolution] = useState(false);
  const [fullResolutionLoaded, setFullResolutionLoaded] = useState(false);
  const [fullResolutionFailed, setFullResolutionFailed] = useState(false);

  useEffect(() => {
    if (!sources.fullResolution) return;

    let idleCallbackId: number | null = null;
    const delayId = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleCallbackId = window.requestIdleCallback(
          () => setAllowFullResolution(true),
          { timeout: FULL_RESOLUTION_IDLE_TIMEOUT_MS },
        );
        return;
      }
      setAllowFullResolution(true);
    }, FULL_RESOLUTION_DELAY_MS);

    return () => {
      window.clearTimeout(delayId);
      if (idleCallbackId != null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [sources.fullResolution]);

  const showFullResolution =
    Boolean(sources.fullResolution) &&
    (allowFullResolution || previewFailed) &&
    !fullResolutionFailed;
  const hasVisiblePhoto =
    (previewLoaded && !previewFailed) || fullResolutionLoaded;
  const hasPhoto =
    Boolean(sources.preview && !previewFailed) || showFullResolution;

  return (
    <div className="relative h-52 w-full overflow-hidden bg-foreground/[0.04] sm:h-56">
      {(loading || (hasPhoto && !hasVisiblePhoto)) && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-linear-to-br from-foreground/[0.04] via-foreground/[0.08] to-foreground/[0.04]"
        />
      )}

      {sources.preview && !previewFailed && (
        <Image
          key={`preview:${sources.preview}`}
          src={sources.preview}
          alt="Aircraft"
          fill
          sizes="(min-width: 640px) 368px, 100vw"
          unoptimized
          loading="eager"
          fetchPriority="low"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setPreviewLoaded(true)}
          onError={() => {
            setPreviewFailed(true);
            if (sources.fullResolution) setAllowFullResolution(true);
          }}
          className={`object-cover ${previewLoaded ? "opacity-100" : "opacity-0"}`}
          draggable={false}
        />
      )}

      {showFullResolution && sources.fullResolution && (
        <Image
          key={`full:${sources.fullResolution}`}
          src={sources.fullResolution}
          alt=""
          fill
          sizes="(min-width: 640px) 368px, 100vw"
          unoptimized
          loading="lazy"
          fetchPriority="low"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setFullResolutionLoaded(true)}
          onError={() => setFullResolutionFailed(true)}
          className={`object-cover transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${fullResolutionLoaded ? "opacity-100" : "opacity-0"}`}
          draggable={false}
        />
      )}

      {hasVisiblePhoto && (
        <>
          <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-background/55 via-background/5 to-transparent" />
          {photographer && (
            <span className="absolute bottom-2 right-2.5 flex items-center gap-1 rounded-full border border-foreground/[0.06] bg-background/55 px-2.5 py-1 text-[9px] font-medium text-foreground/65 shadow-sm backdrop-blur-md">
              <Camera className="h-2.5 w-2.5" />
              {photographer}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function HeroBanner({ photo, loading }: HeroBannerProps) {
  const sources = useMemo<HeroSources>(() => {
    const thumbnail = photo?.thumbnail?.trim() || null;
    const fullResolution = photo?.url?.trim() || null;
    const preview = thumbnail ?? fullResolution;

    return {
      preview,
      fullResolution:
        fullResolution && fullResolution !== preview ? fullResolution : null,
    };
  }, [photo?.thumbnail, photo?.url]);
  const sourceKey = `${sources.preview ?? ""}|${sources.fullResolution ?? ""}`;

  return (
    <HeroMedia
      key={`${photo?.id ?? "no-photo"}:${sourceKey}`}
      sources={sources}
      photographer={photo?.photographer ?? null}
      loading={loading}
    />
  );
}
