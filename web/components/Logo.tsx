/* eslint-disable @next/next/no-img-element -- pixel sprite, rendered with image-rendering: pixelated */
import { MARK } from "@/lib/util";

export default function Logo({ small }: { small?: boolean }) {
  return (
    <div className="logo" style={small ? { fontSize: 20 } : undefined}>
      <img className={small ? "mk sm" : "mk"} src={MARK} alt="" />
      <span>JUM<b>PER</b></span>
    </div>
  );
}
