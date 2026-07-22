import { useEffect, useState } from "react";
import { accrualApi } from "../../api/accrual";
import { ledgerApi } from "../../api/ledger";
import { pickMultipleReceiptFiles, PickedFile } from "../../lib/googleDrive";
import EntryPicker from "./EntryPicker";
import { LinkableEntry } from "./types";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";

function stripExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

interface Row {
  file: PickedFile;
  candidates: LinkableEntry[];
  selectedKey: string | null; // `${source}:${id}`
  status: "pending" | "saving" | "saved" | "error";
  errorMsg?: string;
}

/** One-off bulk tool: pick many pre-existing receipt files from Drive at
 * once (a single consent step, since drive.file only grants access to files
 * the app created or the user explicitly picked), auto-match each to a
 * ledger entry by exact Check/Invoice Name == filename (minus extension),
 * and let you confirm/override before saving. Covers both Actual and
 * Accrual, since old invoices can belong to either ledger. */
export default function LinkReceipts() {
  const [entries, setEntries] = useState<LinkableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const { widths, startResize } = useColumnWidths("link-receipts");

  async function load() {
    setLoading(true);
    try {
      const [reconciliation, accrual] = await Promise.all([ledgerApi.list(), accrualApi.list()]);
      setEntries([
        ...reconciliation.map((e) => ({ ...e, source: "reconciliation" as const })),
        ...accrual.map((e) => ({ ...e, source: "accrual" as const })),
      ]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function matchKeyFor(file: PickedFile): { candidates: LinkableEntry[]; selectedKey: string | null } {
    const base = stripExtension(file.name).trim().toLowerCase();
    const candidates = entries.filter(
      (e) => !e.receipt_file_id && e.check_invoice_name.trim().toLowerCase() === base
    );
    return { candidates, selectedKey: candidates.length === 1 ? `${candidates[0].source}:${candidates[0].id}` : null };
  }

  async function selectFiles() {
    setError("");
    setPicking(true);
    try {
      const files = await pickMultipleReceiptFiles();
      const newRows: Row[] = files.map((file) => {
        const { candidates, selectedKey } = matchKeyFor(file);
        return { file, candidates, selectedKey, status: "pending" };
      });
      setRows((prev) => [...prev, ...newRows]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPicking(false);
    }
  }

  function setRowSelection(fileId: string, key: string | null) {
    setRows((prev) => prev.map((r) => (r.file.id === fileId ? { ...r, selectedKey: key } : r)));
  }

  function removeRow(fileId: string) {
    setRows((prev) => prev.filter((r) => r.file.id !== fileId));
  }

  async function linkAll() {
    setSaving(true);
    const toSave = rows.filter((r) => r.selectedKey && r.status !== "saved");
    for (const row of toSave) {
      setRows((prev) => prev.map((r) => (r.file.id === row.file.id ? { ...r, status: "saving" } : r)));
      const [source, idStr] = row.selectedKey!.split(":");
      const id = Number(idStr);
      const patch = {
        receipt_file_id: row.file.id,
        receipt_file_name: row.file.name,
        receipt_web_view_link: row.file.url,
      };
      try {
        if (source === "reconciliation") await ledgerApi.update(id, patch);
        else await accrualApi.update(id, patch);
        setRows((prev) => prev.map((r) => (r.file.id === row.file.id ? { ...r, status: "saved" } : r)));
      } catch (err) {
        setRows((prev) =>
          prev.map((r) =>
            r.file.id === row.file.id ? { ...r, status: "error", errorMsg: (err as Error).message } : r
          )
        );
      }
    }
    setSaving(false);
    await load(); // refresh entries so already-linked ones stop showing as candidates
  }

  const matchedCount = rows.filter((r) => r.selectedKey).length;
  const savedCount = rows.filter((r) => r.status === "saved").length;

  return (
    <div>
      <h2 className="page-title">Link Receipts</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Bulk-attach existing invoice files already sitting in Google Drive to their matching Actual
        or Accrual entries. Files are matched to an entry by exact Check/Invoice Name (the file name,
        minus its extension) - anything that doesn't match exactly, or matches more than one entry,
        needs a manual pick before it can be linked.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="toolbar">
          <button className="btn" onClick={selectFiles} disabled={picking || loading}>
            {picking ? "Opening Google Drive…" : "Select files from Google Drive"}
          </button>
          {rows.length > 0 && (
            <button className="btn secondary" onClick={linkAll} disabled={saving || matchedCount === 0}>
              {saving ? "Linking…" : `Link ${matchedCount} of ${rows.length} file${rows.length === 1 ? "" : "s"}`}
            </button>
          )}
          {savedCount > 0 && (
            <span className="pill bank">
              {savedCount} linked{savedCount < rows.length ? ` · ${rows.length - savedCount} remaining` : ""}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="subtitle" style={{ marginBottom: 0 }}>
            {loading ? "Loading entries…" : "No files selected yet."}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="resizable-cols">
              <ColGroup columns={["file", "matched_entry", "status", "actions"]} widths={widths} />
              <thead>
                <tr>
                  <th>
                    File
                    <ColResizeHandle col="file" startResize={startResize} />
                  </th>
                  <th>
                    Matched entry
                    <ColResizeHandle col="matched_entry" startResize={startResize} />
                  </th>
                  <th>
                    Status
                    <ColResizeHandle col="status" startResize={startResize} />
                  </th>
                  <th>
                    <ColResizeHandle col="actions" startResize={startResize} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.file.id}>
                    <td>
                      <a href={row.file.url} target="_blank" rel="noreferrer">
                        {row.file.name}
                      </a>
                      {row.candidates.length > 1 && (
                        <div style={{ color: "var(--amber)", fontSize: 12 }}>
                          {row.candidates.length} entries share this Check/Invoice Name - pick one
                        </div>
                      )}
                      {row.candidates.length === 0 && !row.selectedKey && (
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>No automatic match found</div>
                      )}
                    </td>
                    <td style={{ minWidth: 320 }}>
                      <EntryPicker
                        value={row.selectedKey}
                        entries={entries}
                        onChange={(key) => setRowSelection(row.file.id, key)}
                      />
                    </td>
                    <td>
                      {row.status === "pending" && <span style={{ color: "var(--muted)" }}>—</span>}
                      {row.status === "saving" && <span className="pill stripe">Saving…</span>}
                      {row.status === "saved" && <span className="pill bank">✓ Linked</span>}
                      {row.status === "error" && (
                        <span className="pill warn" title={row.errorMsg}>
                          Failed
                        </span>
                      )}
                    </td>
                    <td>
                      <button className="link" onClick={() => removeRow(row.file.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
