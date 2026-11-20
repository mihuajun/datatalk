"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeAvatar } from "@/lib/avatar";

export function UserAvatar({ avatar, name }: { avatar?: string | null; name: string }) {
  const src = normalizeAvatar(avatar);
  const [failed, setFailed] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // An SSR image may fail before hydration attaches React's error handler.
    if (src && imageRef.current?.complete && imageRef.current.naturalWidth === 0) setFailed(src);
  }, [src]);
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e3edff] text-xs font-bold text-[#2167E8]">
    {src && src !== failed ? <img ref={imageRef} src={src} alt={`${name}的头像`} className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setFailed(src)} /> : name.slice(0, 1)}
  </span>;
}
