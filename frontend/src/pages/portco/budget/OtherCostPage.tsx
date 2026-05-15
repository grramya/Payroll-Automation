import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert, CircularProgress, IconButton, Tooltip,
} from '@mui/material';
import { apiClient } from '../../../api/api';
import { StepNav } from '../components/WorkflowBanner';

const BRAND = '#512D6D';

const COST_GROUPINGS = [
  'Recruiting', 'Software *', 'Dues & Subscriptions', 'Travel',
  'Office Supplies/Equipment', 'Training', 'Outside Contractors',
  'Managed Services Allocation', 'Interns', 'Conferences', 'Legal',
  'Accounting/Tax', 'Outsourced IT', 'Company Snacks/Meals', 'Rent',
  'Utilities/Cleaning', 'Telephone & Internet', 'Insurance',
  'COE', 'Digital', 'Events', 'Industry Ads', 'Printing', 'Website', 'Other',
];

const DEPARTMENTS = [
  'Product Development', 'Sales', 'Marketing', 'Customer Success', 'Finance',
];

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const TH: CSSProperties = {
  padding: '7px 10px', background: '#F1F5F9', fontWeight: 700,
  fontSize: '0.72rem', whiteSpace: 'nowrap', borderBottom: '1px solid #E2E8F0',
  color: '#334155', position: 'sticky', top: 0, zIndex: 2,
};
const TD: CSSProperties = {
  padding: '8px 10px', fontSize: '0.82rem', borderBottom: '1px solid #F1F5F9',
  whiteSpace: 'nowrap',
};
const TD_NUM: CSSProperties = { ...TD, textAlign: 'right', fontFamily: 'monospace' };
const TD_TOTAL: CSSProperties = {
  ...TD_NUM, fontWeight: 700, background: '#EFF6FF', color: '#1D4ED8',
};

const TH_DARK: CSSProperties = {
  padding: '9px 10px',
  background: '#1E293B',
  color: '#CBD5E1',
  fontWeight: 700,
  fontSize: '0.7rem',
  whiteSpace: 'nowrap',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  borderRight: '1px solid #334155',
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  height: '34px',
  padding: '0 10px',
  fontSize: '0.85rem',
  border: '1px solid #E2E8F0',
  borderRadius: 4,
  outline: 'none',
  background: '#fff',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

function fmt(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export interface OtherCostRecord {
  id: number;
  department: string;
  year: number;
  cost_grouping: string;
  vendor_name: string;
  memo_description: string;
  amount: number;
}

interface FormState {
  cost_grouping: string;
  vendor_name: string;
  memo_description: string;
  amount: string;
}

const EMPTY_FORM: FormState = {
  cost_grouping: '', vendor_name: '', memo_description: '', amount: '',
};

const LS_KEY_OTHER = 'portco_other_cost_draft';

function loadOtherDraft(): FormState {
  try { return { ...EMPTY_FORM, ...JSON.parse(localStorage.getItem(LS_KEY_OTHER) || '{}') }; }
  catch { return EMPTY_FORM; }
}

interface Props {
  year: number;
  userDept: string | null;
  isAdmin: boolean;
}

export default function OtherCostPage({ year, userDept, isAdmin }: Props) {
  const [rows, setRows]             = useState<OtherCostRecord[]>([]);
  const [loading, setLoading]       = useState(true);
  const [hasLoaded, setHasLoaded]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [editId, setEditId]         = useState<number | null>(null);
  const [editForm, setEditFormState]= useState<FormState>(EMPTY_FORM);
  const [form, setForm]             = useState<FormState>(() => isAdmin ? EMPTY_FORM : loadOtherDraft());
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [filterDept, setFilterDept] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { year };
      if (isAdmin && filterDept) params.department = filterDept;
      const { data } = await apiClient.get<OtherCostRecord[]>('/portco/budget/other-cost', { params });
      setRows(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Failed to load data');
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [year, isAdmin, filterDept]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!isAdmin && editId === null) {
      localStorage.setItem(LS_KEY_OTHER, JSON.stringify(form));
    }
  }, [form, editId, isAdmin]);

  function setField(k: keyof FormState, v: string) {
    setForm(prev => ({ ...prev, [k]: v }));
    setFormErrors(prev => ({ ...prev, [k]: undefined }));
  }

  function setEditField(k: keyof FormState, v: string) {
    setEditFormState(prev => ({ ...prev, [k]: v }));
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.cost_grouping) errs.cost_grouping = 'Required';
    if (!form.vendor_name.trim()) errs.vendor_name = 'Required';
    if (!form.amount || isNaN(Number(form.amount))) errs.amount = 'Required numeric';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function startEdit(row: OtherCostRecord) {
    setEditId(row.id);
    setEditFormState({
      cost_grouping:    row.cost_grouping,
      vendor_name:      row.vendor_name,
      memo_description: row.memo_description ?? '',
      amount:           String(row.amount),
    });
  }

  function cancelEdit() {
    setEditId(null);
    setEditFormState(EMPTY_FORM);
  }

  function copyRow(row: OtherCostRecord) {
    setForm({
      cost_grouping:    row.cost_grouping,
      vendor_name:      row.vendor_name,
      memo_description: row.memo_description ?? '',
      amount:           String(row.amount),
    });
    setFormErrors({});
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    setError(null);
    const payload = {
      department:       userDept,
      year,
      cost_grouping:    form.cost_grouping,
      vendor_name:      form.vendor_name.trim(),
      memo_description: form.memo_description.trim(),
      amount:           parseFloat(form.amount),
    };
    try {
      const { data: created } = await apiClient.post<OtherCostRecord>('/portco/budget/other-cost', payload);
      setRows(prev => [...prev, created]);
      setForm(EMPTY_FORM);
      setFormErrors({});
      localStorage.removeItem(LS_KEY_OTHER);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!editForm.cost_grouping) errs.cost_grouping = 'Required';
    if (!editForm.vendor_name.trim()) errs.vendor_name = 'Required';
    if (!editForm.amount || isNaN(Number(editForm.amount))) errs.amount = 'Required';
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }

    setSaving(true);
    setError(null);
    const payload = {
      department:       userDept,
      year,
      cost_grouping:    editForm.cost_grouping,
      vendor_name:      editForm.vendor_name.trim(),
      memo_description: editForm.memo_description.trim(),
      amount:           parseFloat(editForm.amount),
    };
    try {
      const { data: updated } = await apiClient.put<OtherCostRecord>(`/portco/budget/other-cost/${editId}`, payload);
      setRows(prev => prev.map(r => r.id === editId ? updated : r));
      setEditId(null);
      setEditFormState(EMPTY_FORM);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this entry?')) return;
    try {
      await apiClient.delete(`/portco/budget/other-cost/${id}`);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Delete failed');
    }
  }

  // ── admin: consolidated report ────────────────────────────────────────────
  if (isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <PageHeader title="Other Cost — Consolidated Report" badge="Admin View">
          <select
            value={filterDept}
            onChange={e => setFilterDept(e.target.value)}
            style={{
              padding: '4px 8px', borderRadius: 6, border: '1px solid #CBD5E1',
              fontSize: '0.75rem', background: '#fff', cursor: 'pointer',
            }}
          >
            <option value="">All Departments</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button
            onClick={loadData}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, cursor: loading ? 'default' : 'pointer',
              background: '#fff', border: '1px solid #CBD5E1',
              fontSize: '0.75rem', fontWeight: 600, color: '#475569',
            }}
          >
            <span className="material-icons-round" style={{ fontSize: 14 }}>refresh</span>
            Refresh
          </button>
        </PageHeader>
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', padding: 16 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <CircularProgress size={32} />
            </div>
          ) : (
            <OtherCostReport rows={rows} onDelete={handleDelete} />
          )}
        </div>
      </div>
    );
  }

  // ── user: loading state ───────────────────────────────────────────────────
  if (!hasLoaded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <PageHeader title="Other Cost" badge="Budget Entry"><StepNav currentStep={4} /></PageHeader>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={32} />
        </div>
      </div>
    );
  }

  // ── user: inline row table ────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader title="Other Cost" badge="Budget Entry">
        <StepNav currentStep={4} />
      </PageHeader>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <div style={{ overflowX: 'auto', border: '1px solid #334155', borderRadius: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr>
                <th style={{ ...TH_DARK, width: 44, textAlign: 'center' }}>#</th>
                <th style={{ ...TH_DARK, minWidth: 170 }}>COST GROUPING</th>
                <th style={{ ...TH_DARK, minWidth: 150 }}>VENDOR NAME</th>
                <th style={{ ...TH_DARK, textAlign: 'right', minWidth: 140 }}>AMOUNT (USD)</th>
                <th style={{ ...TH_DARK, minWidth: 220 }}>MEMO / DESCRIPTION</th>
                <th style={{ ...TH_DARK, width: 90, borderRight: 'none' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                    const isEditing = editId === row.id;
                    return (
                      <tr
                        key={row.id}
                        style={{
                          background: isEditing ? '#F5F3FF' : '#fff',
                          borderBottom: '1px solid #F1F5F9',
                        }}
                      >
                        <td style={{ ...TD, textAlign: 'center', color: '#94A3B8', fontWeight: 600, width: 44 }}>
                          {idx + 1}
                        </td>

                        {isEditing ? (
                          <>
                            <td style={TD}>
                              <select
                                value={editForm.cost_grouping}
                                onChange={e => setEditField('cost_grouping', e.target.value)}
                                style={INPUT_STYLE}
                              >
                                <option value="">Select...</option>
                                {COST_GROUPINGS.map(g => <option key={g} value={g}>{g}</option>)}
                              </select>
                            </td>
                            <td style={TD}>
                              <input
                                value={editForm.vendor_name}
                                onChange={e => setEditField('vendor_name', e.target.value)}
                                style={INPUT_STYLE}
                              />
                            </td>
                            <td style={TD}>
                              <input
                                type="number"
                                value={editForm.amount}
                                onChange={e => setEditField('amount', e.target.value)}
                                style={{ ...INPUT_STYLE, textAlign: 'right' }}
                              />
                            </td>
                            <td style={TD}>
                              <input
                                value={editForm.memo_description}
                                onChange={e => setEditField('memo_description', e.target.value)}
                                style={INPUT_STYLE}
                              />
                            </td>
                            <td style={{ ...TD, textAlign: 'right' }}>
                              <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                                <button
                                  onClick={saveEdit}
                                  disabled={saving}
                                  style={{
                                    padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700,
                                    background: BRAND, color: '#fff', border: 'none',
                                    borderRadius: 4, cursor: saving ? 'default' : 'pointer',
                                    opacity: saving ? 0.6 : 1,
                                  }}
                                >
                                  {saving ? '...' : 'Save'}
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  style={{
                                    padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700,
                                    background: '#F1F5F9', color: '#64748B', border: 'none',
                                    borderRadius: 4, cursor: 'pointer',
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={TD}>
                              <span style={{
                                display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                                fontSize: '0.7rem', fontWeight: 600, background: '#E0F2FE', color: '#0369A1',
                              }}>
                                {row.cost_grouping}
                              </span>
                            </td>
                            <td style={TD}>{row.vendor_name}</td>
                            <td style={{ ...TD_NUM, fontWeight: 600 }}>{fmt(row.amount)}</td>
                            <td style={{ ...TD, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {row.memo_description || '—'}
                            </td>
                            <td style={{ ...TD, textAlign: 'right' }}>
                              <Tooltip title="Edit">
                                <IconButton size="small" onClick={() => startEdit(row)}>
                                  <span className="material-icons-round" style={{ fontSize: 15, color: '#6366F1' }}>edit</span>
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Copy to new row">
                                <IconButton size="small" onClick={() => copyRow(row)}>
                                  <span className="material-icons-round" style={{ fontSize: 15, color: '#64748B' }}>content_copy</span>
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Delete">
                                <IconButton size="small" onClick={() => handleDelete(row.id)}>
                                  <span className="material-icons-round" style={{ fontSize: 15, color: '#EF4444' }}>delete</span>
                                </IconButton>
                              </Tooltip>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}

                  {/* New entry row */}
                  <tr style={{ background: '#FAFBFC', borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ ...TD, textAlign: 'center', color: '#CBD5E1', fontWeight: 600 }}>
                      {rows.length + 1}
                    </td>
                    <td style={TD}>
                      <select
                        value={form.cost_grouping}
                        onChange={e => setField('cost_grouping', e.target.value)}
                        style={{
                          ...INPUT_STYLE,
                          borderColor: formErrors.cost_grouping ? '#EF4444' : '#E2E8F0',
                        }}
                      >
                        <option value="">Select grouping...</option>
                        {COST_GROUPINGS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    <td style={TD}>
                      <input
                        value={form.vendor_name}
                        onChange={e => setField('vendor_name', e.target.value)}
                        placeholder="Vendor name"
                        style={{
                          ...INPUT_STYLE,
                          borderColor: formErrors.vendor_name ? '#EF4444' : '#E2E8F0',
                        }}
                      />
                    </td>
                    <td style={TD}>
                      <input
                        type="number"
                        value={form.amount}
                        onChange={e => setField('amount', e.target.value)}
                        placeholder="0.00"
                        style={{
                          ...INPUT_STYLE,
                          textAlign: 'right',
                          borderColor: formErrors.amount ? '#EF4444' : '#E2E8F0',
                        }}
                      />
                    </td>
                    <td style={TD}>
                      <input
                        value={form.memo_description}
                        onChange={e => setField('memo_description', e.target.value)}
                        placeholder="Optional memo"
                        style={INPUT_STYLE}
                      />
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <Tooltip title="Add row">
                        <IconButton size="small" onClick={handleSubmit} disabled={saving}>
                          <span className="material-icons-round" style={{ fontSize: 20, color: saving ? '#CBD5E1' : BRAND }}>
                            add_circle
                          </span>
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Clear">
                        <IconButton
                          size="small"
                          onClick={() => { setForm(EMPTY_FORM); setFormErrors({}); }}
                          disabled={saving}
                        >
                          <span className="material-icons-round" style={{ fontSize: 15, color: '#CBD5E1' }}>clear</span>
                        </IconButton>
                      </Tooltip>
                    </td>
                  </tr>
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#94A3B8', textAlign: 'right' }}>
            {rows.length} {rows.length === 1 ? 'entry' : 'entries'} · Total:{' '}
            <strong style={{ color: '#1D4ED8' }}>
              {fmt(rows.reduce((s, r) => s + r.amount, 0))}
            </strong>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Admin Consolidated Report ─────────────────────────────────────────────────
function OtherCostReport({ rows, onDelete }: { rows: OtherCostRecord[]; onDelete?: (id: number) => void }) {
  if (rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>
        <span className="material-icons-round" style={{ fontSize: 48, display: 'block', marginBottom: 8 }}>receipt_long</span>
        No other cost data submitted yet.
      </div>
    );
  }

  const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

  const orderedGroups: string[] = [];
  COST_GROUPINGS.forEach(g => { if (rows.some(r => r.cost_grouping === g)) orderedGroups.push(g); });
  rows.forEach(r => { if (!orderedGroups.includes(r.cost_grouping)) orderedGroups.push(r.cost_grouping); });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.76rem', minWidth: 1000 }}>
        <thead>
          <tr>
            <th style={{ ...TH, minWidth: 80 }}>Department</th>
            <th style={{ ...TH, minWidth: 160 }}>Cost Grouping</th>
            <th style={{ ...TH, minWidth: 120 }}>Vendor Name</th>
            <th style={{ ...TH, minWidth: 160 }}>Memo / Description</th>
            <th style={{ ...TH, textAlign: 'right', minWidth: 80 }}>Amount</th>
            {MONTH_LABELS.map(m => (
              <th key={m} style={{ ...TH, textAlign: 'right', minWidth: 72 }}>{m}</th>
            ))}
            <th style={{ ...TH, textAlign: 'right', minWidth: 90, background: '#DBEAFE' }}>Total</th>
            {onDelete && <th style={{ ...TH, minWidth: 60 }} />}
          </tr>
        </thead>
        <tbody>
          {orderedGroups.map(grp => {
            const items = rows.filter(r => r.cost_grouping === grp);
            return items.map((row, idx) => (
              <tr key={row.id}>
                <td style={TD}>{row.department}</td>
                {idx === 0 ? (
                  <td rowSpan={items.length} style={{ ...TD, fontWeight: 600, background: '#F8FAFC', verticalAlign: 'top' }}>
                    {grp}
                  </td>
                ) : null}
                <td style={TD}>{row.vendor_name}</td>
                <td style={{ ...TD, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.memo_description || '—'}
                </td>
                <td style={{ ...TD_NUM, fontWeight: 700 }}>{fmt(row.amount)}</td>
                {Array.from({ length: 12 }, (_, i) => (
                  <td key={i} style={TD_NUM}>{fmt(row.amount / 12)}</td>
                ))}
                <td style={TD_TOTAL}>{fmt(row.amount)}</td>
                {onDelete && (
                  <td style={TD}>
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => onDelete(row.id)}>
                        <span className="material-icons-round" style={{ fontSize: 15, color: '#EF4444' }}>delete</span>
                      </IconButton>
                    </Tooltip>
                  </td>
                )}
              </tr>
            ));
          })}

          <tr style={{ background: '#F0FDF4' }}>
            <td colSpan={4} style={{ ...TD, fontWeight: 700, color: '#166534' }}>Total Other Costs</td>
            <td style={{ ...TD_NUM, fontWeight: 700, color: '#166534' }}>{fmt(grandTotal)}</td>
            {Array.from({ length: 12 }, (_, i) => (
              <td key={i} style={{ ...TD_NUM, fontWeight: 700, color: '#166534', background: '#F0FDF4' }}>
                {fmt(grandTotal / 12)}
              </td>
            ))}
            <td style={{ ...TD_TOTAL, background: '#DCFCE7', color: '#166534' }}>{fmt(grandTotal)}</td>
            {onDelete && <td style={TD} />}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PageHeader({
  title, badge, children,
}: {
  title: string;
  badge: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 20px', background: '#FAFBFC',
      borderBottom: '1px solid #E5E7EB', flexShrink: 0, flexWrap: 'wrap', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>{title}</span>
        <span style={{
          fontSize: '0.68rem', fontWeight: 700, color: '#7C3AED',
          background: '#EDE9F7', borderRadius: 4, padding: '2px 8px',
        }}>{badge}</span>
      </div>
      {children && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>}
    </div>
  );
}
