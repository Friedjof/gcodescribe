import { useState } from "react";
import Modal from "./Modal";
import PaginationBar from "./paging/PaginationBar";
/** Long reference text stays readable without expanding the surrounding editor. */
export default function TextPreviewDialog({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const chunks = text.match(/[\s\S]{1,1000}(?:\s|$)|[\s\S]{1,1000}/g) ?? [""];
  const current = Math.min(page, chunks.length - 1);
  return <Modal title={title} onClose={onClose} className="text-preview-dialog" footer={<PaginationBar label={title} page={current} pages={chunks.length} onChange={setPage}/>}><pre>{chunks[current]}</pre></Modal>;
}
