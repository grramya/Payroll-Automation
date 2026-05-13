import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import {
  Button, TextField, MenuItem, Alert,
  CircularProgress, IconButton, Tooltip,
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

// ── table cell styles ─────────────────────────────────────────────────────────
const TH: CSSProperties = {
  padding: '7px 10px', background: '#F1F5F9', fontWeight: 700,
  fontSize: '0.72rem', whiteSpace: 'nowrap', borderBottom: '1px solid #E2E8F0',
  color: '#334155', position: 'sticky', top: 0, zIndex: 2,
};
const TD: CSSProperties = {
  padding: '6px 10px', fontSize: '0.78rem', borderBottom: '1px solid #F1F5F9',
  whiteSpace: 'nowrap',
};
const TD_NUM: CSSProperties = { ...TD, textAlign: 'right', fontFamily: 'monospace' };
const TD_TOTAL: CSSProperties = {
  ...TD_NUM, fontWeight: 700, background: '#EFF6FF', color: '#1D4ED8',
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

interface Props {
  year: number;
  userDept: string | null;
  isAdmin: boolean;
}

export default function OtherCostPage({ year, userDept, isAdmin }: Props) {
  const [rows, setRows]           = useState<OtherCostRecord[]>([]);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<'idle' | 'submitted' | 'updated'>('idle');
  const [editId, setEditId]       = useState<number | null>(null);
  const [form, setForm]           = useState<FormState>(EMPTY_FORM);
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
      if (isAdmin) setError(e?.response?.data?.detail ?? 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [year, isAdmin, filterDept]);

  useEffect(() => { loadData(); }, [loadData]);

  function setField(k: keyof FormState, v: string) {
    setForm(prev => ({ ...prev, [k]: v }));
    setFormErrors(prev => ({ ...prev, [k]: undefined }));
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
    setForm({
      cost_grouping:    row.cost_grouping,
      vendor_name:      row.vendor_name,
      memo_description: row.memo_description ?? '',
      amount:           String(row.amount),
    });
    setFormErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setSubmitState('idle');
  }

  function submitAnother() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setSubmitState('idle');
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
      if (editId != null) {
        const { data: updated } = await apiClient.put<OtherCostRecord>(`/portco/budget/other-cost/${editId}`, payload);
        setRows(prev => prev.map(r => r.id === editId ? updated : r));
        setSubmitState('updated');
      } else {
        const { data: created } = await apiClient.post<OtherCostRecord>('/portco/budget/other-cost', payload);
        setRows(prev => [...prev, created]);
        setSubmitState('submitted');
      }
      setEditId(null);
      setForm(EMPTY_FORM);
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
            <OtherCostReport rows={rows} />
          )}
        </div>
      </div>
    );
  }

  // ── user: confirmation screen ────────────────────────────────────────────
  if (submitState === 'submitted' || submitState === 'updated') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <PageHeader title="Other Cost" badge="Budget Entry"><StepNav currentStep={4} /></PageHeader>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <div style={{
            background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
            padding: '48px 40px', maxWidth: 440, width: '100%', textAlign: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: '#DCFCE7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <span className="material-icons-round" style={{ fontSize: 30, color: '#16A34A' }}>check</span>
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#111827', marginBottom: 8 }}>
              {submitState === 'updated' ? 'Changes Saved' : 'Submitted Successfully'}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#6B7280', marginBottom: 32 }}>
              {submitState === 'updated'
                ? 'Your entry has been updated.'
                : 'Your cost entry has been recorded.'}
            </div>
            <Button
              variant="outlined"
              onClick={submitAnother}
              fullWidth
              sx={{ borderColor: BRAND, color: BRAND, fontWeight: 600, py: 1.1,
                    '&:hover': { background: '#F5F3FF', borderColor: BRAND } }}
            >
              Submit another response
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── user: inline input form + submitted entries ───────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        title={editId != null ? 'Other Cost — Edit Entry' : 'Other Cost — Add Entry'}
        badge="Budget Entry"
      ><StepNav currentStep={4} /></PageHeader>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {/* ── Inline form ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{
            background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
            padding: '32px 36px', marginBottom: 28,
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
            width: '100%', maxWidth: 480,
          }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1E293B', marginBottom: 24, textAlign: 'center' }}>
              {editId != null ? 'Edit Cost Entry' : 'Cost Details'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <TextField
                select label="Cost Grouping" size="small" required fullWidth
                value={form.cost_grouping}
                onChange={e => setField('cost_grouping', e.target.value)}
                error={!!formErrors.cost_grouping} helperText={formErrors.cost_grouping}
              >
                {COST_GROUPINGS.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
              </TextField>

              <TextField
                label="Vendor Name" size="small" required fullWidth
                value={form.vendor_name}
                onChange={e => setField('vendor_name', e.target.value)}
                error={!!formErrors.vendor_name} helperText={formErrors.vendor_name}
              />

              <TextField
                label="Annual Amount ($)" size="small" required fullWidth
                type="number" slotProps={{ htmlInput: { min: 0 } }}
                value={form.amount}
                onChange={e => setField('amount', e.target.value)}
                error={!!formErrors.amount} helperText={formErrors.amount}
              />

              <TextField
                label="Memo / Description" size="small" fullWidth multiline rows={3}
                value={form.memo_description}
                onChange={e => setField('memo_description', e.target.value)}
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                <Button
                  variant="contained"
                  onClick={handleSubmit}
                  disabled={saving}
                  fullWidth
                  sx={{ background: BRAND, '&:hover': { background: '#3D1F57' }, py: 1.2, fontWeight: 700 }}
                >
                  {saving
                    ? <CircularProgress size={18} color="inherit" />
                    : editId != null ? 'Save Changes' : 'Submit'
                  }
                </Button>
                {editId != null && (
                  <Button variant="outlined" onClick={cancelEdit} disabled={saving} fullWidth>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Submitted entries ────────────────────────────────────────────── */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <CircularProgress size={28} />
          </div>
        ) : rows.length > 0 ? (
          <>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569', marginBottom: 10 }}>
              Submitted Entries ({rows.length})
            </div>
            <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #E2E8F0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th style={TH}>Cost Grouping</th>
                    <th style={TH}>Vendor Name</th>
                    <th style={TH}>Memo / Description</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Annual Amount</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Monthly</th>
                    <th style={TH}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const isEditing = editId === row.id;
                    return (
                      <tr key={row.id} style={{ background: isEditing ? '#F5F3FF' : undefined }}>
                        <td style={TD}>
                          <span style={{
                            display: 'inline-block', padding: '1px 7px', borderRadius: 10,
                            fontSize: '0.7rem', fontWeight: 600,
                            background: '#E0F2FE', color: '#0369A1',
                          }}>{row.cost_grouping}</span>
                        </td>
                        <td style={TD}>{row.vendor_name}</td>
                        <td style={{ ...TD, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {row.memo_description || '—'}
                        </td>
                        <td style={{ ...TD_NUM, fontWeight: 700 }}>{fmt(row.amount)}</td>
                        <td style={TD_NUM}>{fmt(row.amount / 12)}</td>
                        <td style={TD}>
                          <div style={{ display: 'flex', gap: 2 }}>
                            <Tooltip title="Edit">
                              <IconButton size="small" onClick={() => startEdit(row)}>
                                <span className="material-icons-round" style={{ fontSize: 15, color: '#6366F1' }}>edit</span>
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                              <IconButton size="small" onClick={() => handleDelete(row.id)}>
                                <span className="material-icons-round" style={{ fontSize: 15, color: '#EF4444' }}>delete</span>
                              </IconButton>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── Admin Consolidated Report ─────────────────────────────────────────────────
function OtherCostReport({ rows }: { rows: OtherCostRecord[] }) {
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
              </tr>
            ));
          })}

          {/* Grand Total */}
          <tr style={{ background: '#F0FDF4' }}>
            <td colSpan={4} style={{ ...TD, fontWeight: 700, color: '#166534' }}>Total Other Costs</td>
            <td style={{ ...TD_NUM, fontWeight: 700, color: '#166534' }}>{fmt(grandTotal)}</td>
            {Array.from({ length: 12 }, (_, i) => (
              <td key={i} style={{ ...TD_NUM, fontWeight: 700, color: '#166534', background: '#F0FDF4' }}>
                {fmt(grandTotal / 12)}
              </td>
            ))}
            <td style={{ ...TD_TOTAL, background: '#DCFCE7', color: '#166534' }}>{fmt(grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Shared page header ────────────────────────────────────────────────────────
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
