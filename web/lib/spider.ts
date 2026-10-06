/* ---------- the roaming crawler: capsule body, long jointed legs, bright nodes ----------
 * Ported from prototype.html as is. */
export function spider(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rgb: string,
  a: number,
  ph: number,
  ang?: number,
  dot?: string,
  feet?: [number, number][],
) {
  ang = ang || 0;
  dot = dot || rgb;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const BW = r * 1.35, BH = r * 2.7; /* the body capsule */
  const LEG = [-1.25, -0.45, 0.35, 1.15]; /* where the four pairs leave the body, along its length */

  /* --- legs: two long straight segments, a node at the knee and at the foot --- */
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const wob = Math.sin(ph * 1.5 + i * 1.15 + (side > 0 ? 2.1 : 0));
      const out = LEG[i];
      const ax = side * BW * 0.42, ay = out * BH * 0.3;

      /* femur: straight out to the side, fanned front to back */
      const fan = out * 0.62 + wob * 0.12;
      const L1 = r * (4.8 + 0.7 * wob);
      const kx = ax + side * Math.cos(fan) * L1, ky = ay + Math.sin(fan) * L1;
      /* tibia: continues out and bends away */
      const fan2 = fan + 0.42 + wob * 0.14;
      const L2 = r * (4.4 + 0.8 * Math.cos(ph * 1.2 + i));
      const fx = kx + side * Math.cos(fan2) * L2, fy = ky + Math.sin(fan2) * L2;

      ctx.strokeStyle = "rgba(" + rgb + "," + Math.min(1, a * 1.25) + ")";
      ctx.lineWidth = Math.max(1.4, r * 0.3);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(kx, ky);
      ctx.lineTo(fx, fy);
      ctx.stroke();

      ctx.fillStyle = "rgba(" + dot + "," + Math.min(1, a * 1.55) + ")";
      ctx.beginPath();
      ctx.arc(kx, ky, r * 0.38, 0, 6.283);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(fx, fy, r * 0.44, 0, 6.283);
      ctx.fill();
      if (feet) {
        const ca = Math.cos(ang), sa = Math.sin(ang);
        feet.push([x + fx * ca - fy * sa, y + fx * sa + fy * ca]);
      }
    }
  }

  /* --- body: dark capsule with a bright outline --- */
  ctx.fillStyle = "rgba(10,8,16,.95)";
  ctx.strokeStyle = "rgba(" + rgb + "," + Math.min(1, a * 1.45) + ")";
  ctx.lineWidth = Math.max(1.5, r * 0.34);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-BW / 2, -BH / 2, BW, BH, r * 0.62);
  else ctx.ellipse(0, 0, BW / 2, BH / 2, 0, 0, 6.283);
  ctx.fill();
  ctx.stroke();

  /* the eye node near the head end */
  ctx.fillStyle = "rgba(" + dot + "," + Math.min(1, a * 1.6) + ")";
  ctx.beginPath();
  ctx.arc(0, -BH * 0.22, r * 0.46, 0, 6.283);
  ctx.fill();
  ctx.restore();
}
