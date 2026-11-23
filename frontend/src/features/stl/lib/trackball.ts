import { cameraBasis, type Camera } from "./camera";
import { cross, dot, normalize } from "./vec";
import type { Vec3 } from "./types";

/** Virtual sphere rotation, expressed as the same camera used for 2D output. */
export function trackballRotate(camera:Camera, from:Vec3, to:Vec3) {
  const axis=cross(to,from), length=Math.hypot(...axis);
  if(length<1e-9)return {azimuth:camera.azimuth,elevation:camera.elevation,roll:camera.roll??0};
  const angle=Math.atan2(length,Math.max(-1,Math.min(1,dot(from,to))));
  const b=cameraBasis(camera);
  const world=normalize(b.right.map((v,i)=>v*axis[0]+b.camUp[i]*axis[1]-b.forward[i]*axis[2]) as Vec3);
  const rotate=(v:Vec3):Vec3=>{const c=Math.cos(angle),s=Math.sin(angle),d=dot(world,v),k=cross(world,v);return v.map((x,i)=>x*c+k[i]*s+world[i]*d*(1-c)) as Vec3;};
  const forward=normalize(rotate(b.forward)),right=normalize(rotate(b.right));
  const dir=forward.map(x=>-x) as Vec3;
  const azimuth=camera.up==="z"?Math.atan2(dir[1],dir[0]):Math.atan2(dir[2],dir[0]);
  const elevation=Math.asin(Math.max(-1,Math.min(1,dir[camera.up==="z"?2:1])));
  const base=cameraBasis({...camera,azimuth,elevation,roll:0});
  return {azimuth,elevation,roll:Math.atan2(dot(right,base.camUp),dot(right,base.right))};
}

export function spherePoint(x:number,y:number,width:number,height:number):Vec3 {
  const scale=Math.max(1,Math.min(width,height)/2),sx=(x-width/2)/scale,sy=(height/2-y)/scale;
  const radius=sx*sx+sy*sy;
  return radius<=1?[sx,sy,Math.sqrt(1-radius)]:normalize([sx,sy,0]);
}
