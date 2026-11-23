import {expect,it} from "vitest";
import {cameraBasis,projectPoint,type Camera} from "./camera";
import {spherePoint,trackballRotate} from "./trackball";
import {dot} from "./vec";
it.each(["z","y"] as const)("keeps free rotations orthonormal and uses roll in exported projection (%s up)",up=>{
 let camera:Camera={target:[0,0,0],azimuth:.6,elevation:.3,roll:0,distance:10,perspective:false,fov:1,up};
 const original=projectPoint([2,3,4],cameraBasis(camera));
 for(let i=0;i<20;i++)camera={...camera,...trackballRotate(camera,spherePoint(280,140,400,300),spherePoint(220,220,400,300))};
 const b=cameraBasis(camera);
 expect(Math.hypot(...b.right)).toBeCloseTo(1);expect(Math.hypot(...b.camUp)).toBeCloseTo(1);
 expect(dot(b.right,b.camUp)).toBeCloseTo(0);expect(dot(b.right,b.forward)).toBeCloseTo(0);
 expect(Math.abs(camera.roll!)).toBeGreaterThan(.01);
 expect(projectPoint([2,3,4],b)).not.toEqual(original);
 expect(projectPoint([2,3,4],cameraBasis({...camera,roll:0}))).not.toEqual(projectPoint([2,3,4],b));
});
it("does not rotate for an unchanged pointer",()=>{
 const c:Camera={target:[0,0,0],azimuth:1,elevation:2,roll:3,distance:10,perspective:false,fov:1,up:"z"};
 expect(trackballRotate(c,[0,0,1],[0,0,1])).toEqual({azimuth:1,elevation:2,roll:3});
});
