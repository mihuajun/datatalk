type BrandMarkProps = { className?: string; inverse?: boolean; size?: number };

/** DataTalk brand asset; third-party and functional icons remain independent. */
export function BrandMark({ className, inverse = false, size = 40 }: BrandMarkProps) {
  return <img src={inverse ? "/brand/datatalk-white-v1.svg" : "/brand/datatalk-cobalt-v1.svg"} alt="" aria-hidden="true" width={size} height={size} className={className} />;
}
