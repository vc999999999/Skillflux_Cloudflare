"""Builds the binary fixtures and reference solutions for the xlsx and pdf
tasks. Committed so fixtures are reproducible; run from the repository root:

    python3 bench/tasks/_build/build_fixtures.py

Requires openpyxl and pypdf. PDFs are written by hand (one Helvetica text
object per line) so no PDF-generation dependency is needed.
"""
import csv
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

ROOT = Path(__file__).resolve().parent.parent


def write_csv(path: Path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def save(workbook: Workbook, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(path)


def pdf(path: Path, pages):
    """Minimal valid PDF: pages is a list of lists of text lines."""
    objects = []
    page_ids = []
    font_id = 3
    objects.append(None)  # 1: catalog
    objects.append(None)  # 2: pages
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for lines in pages:
        text = "BT /F1 12 Tf 72 720 Td 16 TL " + " ".join(
            "(" + line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ") Tj T*" for line in lines
        ) + " ET"
        stream = text.encode("latin-1")
        objects.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        content_id = len(objects)
        objects.append(None)
        page_id = len(objects)
        page_ids.append(page_id)
        objects[page_id - 1] = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (font_id, content_id)
        )
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % pid for pid in page_ids) + b"] /Count %d >>" % len(page_ids)
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % index + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(out))


EXPENSES = [("Rent", 1800), ("Groceries", 420), ("Utilities", 165), ("Transport", 120), ("Internet", 60), ("Insurance", 95), ("Gym", 45), ("Savings", 500)]
QUARTERLY = [("North", 12000, 13800), ("South", 9500, 9025), ("East", 15000, 16500), ("West", 8000, 8800), ("Central", 11000, 10450)]
ORDERS = [("Notebook", 120, 3.5), ("Pen", 300, 1.25), ("Stapler", 25, 12.0), ("Folder", 200, 0.8), ("Marker", 150, 2.1), ("Tape", 80, 1.9)]


def xlsx_tasks():
    base = ROOT / "anthropics-skills-xlsx"
    # budget-total-formula
    task = base / "budget-total-formula"
    write_csv(task / "fixtures/expenses.csv", ["Category", "Amount"], EXPENSES)
    wb = Workbook(); ws = wb.active; ws.title = "Budget"
    ws.append(["Category", "Amount"])
    for row in EXPENSES: ws.append(list(row))
    ws.append(["Total", f"=SUM(B2:B{len(EXPENSES) + 1})"]); ws[f"A{len(EXPENSES) + 2}"].font = Font(bold=True)
    save(wb, task / "reference/budget.xlsx")
    # growth-column
    task = base / "growth-column"
    write_csv(task / "fixtures/quarterly.csv", ["Region", "Q1", "Q2"], QUARTERLY)
    wb = Workbook(); ws = wb.active; ws.title = "Quarterly"
    ws.append(["Region", "Q1", "Q2", "Growth"])
    for index, row in enumerate(QUARTERLY, start=2):
        ws.append([*row, f"=C{index}/B{index}-1"]); ws[f"D{index}"].number_format = "0.0%"
    save(wb, task / "reference/quarterly.xlsx")
    # summary-sheet
    task = base / "summary-sheet"
    write_csv(task / "fixtures/orders.csv", ["Product", "Units", "Price"], ORDERS)
    wb = Workbook(); ws = wb.active; ws.title = "Orders"
    ws.append(["Product", "Units", "Price"])
    for row in ORDERS: ws.append(list(row))
    summary = wb.create_sheet("Summary")
    last = len(ORDERS) + 1
    summary.append(["Total units", f"=SUM(Orders!B2:B{last})"])
    summary.append(["Total revenue", f"=SUMPRODUCT(Orders!B2:B{last},Orders!C2:C{last})"])
    save(wb, task / "reference/orders.xlsx")


def pdf_tasks():
    base = ROOT / "anthropics-skills-pdf"
    notice = [["Harbor District Notice", "Water service will pause on Tuesday from 9am to noon.", "Marker: AMBER-HERON-11"],
              ["Page two: alternate supply", "Tankers will stand at the corner of Elm and 3rd.", "Marker: COBALT-FINCH-27"]]
    task = base / "extract-text"
    pdf(task / "fixtures/notice.pdf", notice)
    (task / "reference").mkdir(parents=True, exist_ok=True)
    (task / "reference/notice.txt").write_text("\n".join(notice[0]) + "\n\n" + "\n".join(notice[1]) + "\n")
    part_a = [["Part A, page 1", "Marker: PART-A-ONE"], ["Part A, page 2", "Marker: PART-A-TWO"]]
    part_b = [["Part B, page 1", "Marker: PART-B-ONE"]]
    task = base / "merge"
    pdf(task / "fixtures/part-a.pdf", part_a)
    pdf(task / "fixtures/part-b.pdf", part_b)
    pdf(task / "reference/combined.pdf", part_a + part_b)
    report = [["Annual report, page 1", "Marker: REPORT-P1"], ["Annual report, page 2", "Marker: REPORT-P2-ORCHID"], ["Annual report, page 3", "Marker: REPORT-P3"]]
    task = base / "extract-page"
    pdf(task / "fixtures/report.pdf", report)
    pdf(task / "reference/page-two.pdf", [report[1]])


if __name__ == "__main__":
    xlsx_tasks()
    pdf_tasks()
    print("fixtures and references written")
