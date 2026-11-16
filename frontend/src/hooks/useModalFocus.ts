import { useEffect, useRef, type RefObject } from "react";
const stack: HTMLElement[] = [];
const SELECTOR = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)).filter(element => {
    if(element.closest('[hidden], [inert], [aria-hidden="true"]'))return false;
    let node:HTMLElement|null=element;
    while(node && node!==root){const style=getComputedStyle(node);if(style.display==="none" || style.visibility==="hidden")return false;node=node.parentElement;}
    return true;
  }).sort((left,right)=>left===right?0:left.compareDocumentPosition(right)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
}
/** Only the foremost dialog owns Escape and keyboard focus. */
export function useModalFocus(ref: RefObject<HTMLElement>, onClose: () => void) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if(!dialog)return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(dialog);
    const top=()=>stack[stack.length-1]===dialog;
    const focus=()=>{(focusable(dialog)[0]??dialog).focus();};
    if(!dialog.contains(document.activeElement))focus();
    const key=(event:KeyboardEvent)=>{
      if(!top())return;
      if(event.key==="Escape"){
        event.preventDefault();event.stopImmediatePropagation();close.current();return;
      }
      if(event.key!=="Tab")return;
      const choices=focusable(dialog),first=choices[0],last=choices[choices.length-1];
      if(!choices.length){event.preventDefault();dialog.focus();return;}
      if(event.shiftKey && (document.activeElement===first || !dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey && (document.activeElement===last || !dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    const focusin=(event:FocusEvent)=>{if(top() && !dialog.contains(event.target as Node))focus();};
    document.addEventListener("keydown",key,true);document.addEventListener("focusin",focusin);
    return()=>{
      document.removeEventListener("keydown",key,true);document.removeEventListener("focusin",focusin);
      const index=stack.indexOf(dialog),wasTop=top();if(index!==-1)stack.splice(index,1);
      if(wasTop && previous?.isConnected)previous.focus();
    };
  },[ref]);
}
