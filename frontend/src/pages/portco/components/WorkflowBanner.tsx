import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePortco } from '../../../context/PortcoContext';
import { apiClient } from '../../../api/api';

const STEPS = [
  { id: 1 as const, label: 'Actuals',       path: '/portco/actuals',               icon: 'edit_note'    },
  { id: 2 as const, label: 'Budget',         path: '/portco/budget',                icon: 'calculate'    },
  { id: 3 as const, label: 'Employee Cost',  path: '/portco/budget/employee-cost',  icon: 'people'       },
  { id: 4 as const, label: 'Other Cost',     path: '/portco/budget/other-cost',     icon: 'receipt_long' },
] as const;

type StepId = 1 | 2 | 3 | 4;

interface Props {
  currentStep:    StepId;
  year:           number;
  userDept:       string | null;
  empCostCount?:  number;
  otherCostCount?: number;
}

function hasMapData(map: Record<string, Record<string, number | null>>): boolean {
  return Object.values(map).some(months =>
    Object.values(months).some(v => v != null && v !== 0),
  );
}

export default function WorkflowBanner({ currentStep, year, userDept, empCostCount, otherCostCount }: Props) {
  const navigate = useNavigate();
  const { derivedActuals, derivedBudget } = usePortco();

  const [empCount,   setEmpCount]   = useState<number>(empCostCount   ?? 0);
  const [otherCount, setOtherCount] = useState<number>(otherCostCount ?? 0);

  useEffect(() => {
    const params: Record<string, string | number> = { year };
    if (userDept) params.department = userDept;
    if (empCostCount == null) {
      apiClient.get<{ id: number }[]>('/portco/budget/employee-cost', { params })
        .then(({ data }) => setEmpCount(data.length))
        .catch(() => {});
    }
    if (otherCostCount == null) {
      apiClient.get<{ id: number }[]>('/portco/budget/other-cost', { params })
        .then(({ data }) => setOtherCount(data.length))
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, userDept]);

  useEffect(() => { if (empCostCount  != null) setEmpCount(empCostCount);   }, [empCostCount]);
  useEffect(() => { if (otherCostCount != null) setOtherCount(otherCostCount); }, [otherCostCount]);

  const completed: Record<StepId, boolean> = {
    1: hasMapData(derivedActuals),
    2: hasMapData(derivedBudget),
    3: empCount  > 0,
    4: otherCount > 0,
  };

  const doneCount = STEPS.filter(s => completed[s.id]).length;
  const allDone   = doneCount === 4;
  const nextStep  = STEPS.find(s => s.id > currentStep && !completed[s.id]);

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #E2E8F0',
      borderRadius: 10,
      marginBottom: 20,
      overflow: 'hidden',
    }}>

      {/* ── Title bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid #F1F5F9',
        background: '#FAFBFC',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="material-icons-round" style={{ fontSize: 15, color: '#512D6D' }}>route</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1E293B' }}>
            Planning Workflow
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 64, height: 5, borderRadius: 99, background: '#F1F5F9', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              width: `${(doneCount / 4) * 100}%`,
              background: allDone ? '#16A34A' : '#512D6D',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748B', whiteSpace: 'nowrap' }}>
            {doneCount} / 4
          </span>
        </div>
      </div>

      {/* ── Step track ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '14px 16px',
        overflowX: 'auto',
        gap: 0,
      }}>
        {STEPS.map((step, idx) => {
          const done    = completed[step.id];
          const current = step.id === currentStep;
          const isLast  = idx === STEPS.length - 1;

          return (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>

              {/* ── Step pill ─────────────────────────────────────────────── */}
              <button
                onClick={() => navigate(step.path)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px', borderRadius: 20,
                  background: done   ? '#DCFCE7'
                            : current ? '#EDE9F7'
                            : '#F8FAFC',
                  border: current ? '1.5px solid #512D6D' : '1.5px solid transparent',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                  boxShadow: current ? '0 0 0 3px rgba(81,45,109,0.12)' : 'none',
                }}
              >
                {/* Icon / Check */}
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done    ? '#16A34A'
                              : current ? '#512D6D'
                              : '#CBD5E1',
                }}>
                  <span className="material-icons-round" style={{ fontSize: 12, color: '#fff' }}>
                    {done ? 'check' : step.icon}
                  </span>
                </div>

                {/* Label */}
                <span style={{
                  fontSize: '0.72rem',
                  fontWeight: current ? 700 : done ? 600 : 400,
                  color: done    ? '#166534'
                       : current ? '#3B1A5A'
                       : '#94A3B8',
                }}>
                  {step.label}
                </span>

                {/* Status badge */}
                {(done || current) && (
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700,
                    padding: '1px 5px', borderRadius: 8,
                    background: done ? '#BBF7D0' : '#DDD6F3',
                    color:      done ? '#166534'  : '#512D6D',
                    marginLeft: 2,
                  }}>
                    {done ? 'Done' : 'Here'}
                  </span>
                )}
              </button>

              {/* ── Connector ─────────────────────────────────────────────── */}
              {!isLast && (
                <div style={{
                  width: 28, height: 2, flexShrink: 0, margin: '0 2px',
                  background: done ? '#86EFAC' : '#E2E8F0',
                  borderRadius: 2,
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Next step CTA ─────────────────────────────────────────────────────── */}
      {!allDone && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 16px 10px',
          borderTop: '1px solid #F1F5F9',
          background: '#FAFBFC',
          flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-icons-round" style={{ fontSize: 14, color: '#F59E0B' }}>info</span>
            <span style={{ fontSize: '0.73rem', color: '#475569' }}>
              {nextStep
                ? <>Step {currentStep} of 4 &mdash; complete <strong style={{ color: '#1E293B' }}>{nextStep.label}</strong> next to finish your planning workflow.</>
                : <>Complete the remaining steps to finalize your planning workflow.</>
              }
            </span>
          </div>
          {nextStep && (
            <button
              onClick={() => navigate(nextStep.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: '#512D6D', color: '#fff', border: 'none',
                borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
                fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#3D1F57')}
              onMouseLeave={e => (e.currentTarget.style.background = '#512D6D')}
            >
              Go to {nextStep.label}
              <span className="material-icons-round" style={{ fontSize: 13 }}>arrow_forward</span>
            </button>
          )}
        </div>
      )}

      {allDone && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '9px 16px 10px',
          borderTop: '1px solid #F1F5F9',
          background: '#F0FDF4',
        }}>
          <span className="material-icons-round" style={{ fontSize: 15, color: '#16A34A' }}>verified</span>
          <span style={{ fontSize: '0.73rem', fontWeight: 600, color: '#166534' }}>
            All steps complete — your planning data is ready.
          </span>
        </div>
      )}
    </div>
  );
}

// ── Inline step breadcrumb ────────────────────────────────────────────────────
// Compact horizontal stepper used in every page sub-header.
// Inspired by Stripe / Shopify Admin workflow indicators.

const NAV_STEPS = [
  { id: 1, label: 'Actuals',       path: '/portco/actuals'              },
  { id: 2, label: 'Budget',        path: '/portco/budget'               },
  { id: 3, label: 'Employee Cost', path: '/portco/budget/employee-cost' },
  { id: 4, label: 'Other Cost',    path: '/portco/budget/other-cost'    },
] as const;

type NavStepId = 1 | 2 | 3 | 4;

export function StepNav({ currentStep }: { currentStep?: NavStepId }) {
  const navigate = useNavigate();
  const location = useLocation();

  const activeId: NavStepId =
    currentStep ??
    (NAV_STEPS.find(s => location.pathname === s.path)?.id ?? 1);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 0,
      borderLeft: '1px solid #E2E8F0', paddingLeft: 12, marginLeft: 4,
    }}>
      {NAV_STEPS.map((step, idx) => {
        const isCurrent = step.id === activeId;
        const isLast    = idx === NAV_STEPS.length - 1;

        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center' }}>
            <button
              onClick={() => navigate(step.path)}
              title={`Go to ${step.label}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 7px', borderRadius: 5,
                border: isCurrent ? '1px solid #C4B5D9' : '1px solid transparent',
                background: isCurrent ? '#EDE9F7' : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => {
                if (!isCurrent) e.currentTarget.style.background = '#F8FAFC';
              }}
              onMouseLeave={e => {
                if (!isCurrent) e.currentTarget.style.background = 'transparent';
              }}
            >
              {/* Step indicator dot */}
              <span style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isCurrent ? '#512D6D' : '#E2E8F0',
                fontSize: 9, fontWeight: 800, color: '#fff',
              }}>
                {step.id}
              </span>

              {/* Label */}
              <span style={{
                fontSize: '0.7rem',
                fontWeight: isCurrent ? 700 : 400,
                color: isCurrent ? '#3B1A5A' : '#94A3B8',
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </button>

            {!isLast && (
              <span className="material-icons-round" style={{
                fontSize: 14, color: '#CBD5E1', margin: '0 1px', flexShrink: 0,
              }}>
                chevron_right
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
