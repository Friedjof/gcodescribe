from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile

from ...services.fonts import add_font, delete_font, list_fonts

router = APIRouter(tags=["fonts"])


@router.get("/fonts")
def get_fonts() -> dict:
    return {"fonts": [font.__dict__ for font in list_fonts()]}


@router.post("/fonts")
def upload_font(
    label: str = Form(...), mode: str = Form("plotter"), file: UploadFile = File(...)
) -> dict:
    item = add_font(
        label=label, mode=mode, upload_filename=file.filename or "font", source_file=file.file
    )
    return {"font": item.__dict__, "fonts": [font.__dict__ for font in list_fonts()]}


@router.delete("/fonts/{font_id}")
def remove_font(font_id: str) -> dict:
    delete_font(font_id)
    return {"fonts": [font.__dict__ for font in list_fonts()]}
