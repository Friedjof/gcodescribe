import { useEffect, useState } from "react";
import type { GcodePreview3D } from "../api";
import { useI18n } from "../i18n";
import Gcode3D, { type Gcode3DView } from "./Gcode3D";

/** Fullscreen 3D G-code view. Closes on backdrop click or Escape. */
export default function Gcode3DOverlay({
  data,
  showTravels: travelsProp,
  showBed: bedProp,
  onShowBedChange,
  viewState,
  onViewChange,
  onClose,
}: {
  data: GcodePreview3D;
  showTravels?: boolean;
  showBed?: boolean;
  onShowBedChange?: (show: boolean) => void;
  viewState?: Gcode3DView;
  onViewChange?: (view: Gcode3DView) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const read = (key:string, fallback:boolean) => {try {const v=localStorage.getItem(`gcs.preview.${key}`);return v===null?fallback:v==="true";}catch{return fallback;}};
  const [bedState, setBedState] = useState(()=>read("bed",true));
  const [showTravels,setShowTravels]=useState(()=>travelsProp??read("travels",true));
  const [showProfile,setShowProfile]=useState(()=>read("profile",false));
  const save = (key:string,value:boolean) => {try{localStorage.setItem(`gcs.preview.${key}`,String(value));}catch{}};
  useEffect(()=>{if(travelsProp!==undefined)setShowTravels(travelsProp);},[travelsProp]);
  const showBed = bedProp ?? bedState;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="g3d-fullscreen" onClick={onClose}>
      <div className="g3d-fullscreen-view" onClick={(e) => e.stopPropagation()}>
        <Gcode3D data={data} chrome={false} showTravels={showTravels} showBed={showBed} showProfile={showProfile}
          viewState={viewState} onViewChange={onViewChange} />
        <div className="g3d-fullscreen-controls">
          <label className="g3d-toggle"><input type="checkbox" checked={showTravels} onChange={e=>{setShowTravels(e.target.checked);save("travels",e.target.checked);}}/>{t("g3d.travels")}</label>
          {data.profileOutline && <label className="g3d-toggle"><input type="checkbox" checked={showProfile} onChange={e=>{setShowProfile(e.target.checked);save("profile",e.target.checked);}}/>{t("g3d.profile")}</label>}
          {data.bed && <label className="g3d-toggle">
            <input type="checkbox" checked={showBed} onChange={(e) => {
              setBedState(e.target.checked); save("bed",e.target.checked);
              onShowBedChange?.(e.target.checked);
            }} />
            {t("g3d.bed")} · {data.bed[0]} × {data.bed[1]} mm
          </label>}
          <button type="button" className="ghost" onClick={onClose} aria-label={t("common.close")}>×</button>
        </div>
      </div>
    </div>
  );
}
