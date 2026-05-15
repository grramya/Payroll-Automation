import { useNavigate } from "react-router-dom";

const BRAND = "#512D6D";

interface ReportCard {
  icon: string;
  title: string;
  subtitle: string;
  path: string;
  accent: string;
  bg: string;
}

const REPORTS: ReportCard[] = [
  {
    icon: "table_rows",
    title: "Actuals",
    subtitle: "Monthly actuals entry by department",
    path: "/portco/actuals",
    accent: "#0369A1",
    bg: "#E0F2FE",
  },
  {
    icon: "account_balance",
    title: "Budget Overview",
    subtitle: "Budget vs actuals by department",
    path: "/portco/budget",
    accent: "#7C3AED",
    bg: "#EDE9F7",
  },
  {
    icon: "people",
    title: "Employee Cost",
    subtitle: "Headcount and salary budget planning",
    path: "/portco/budget/employee-cost",
    accent: "#059669",
    bg: "#D1FAE5",
  },
  {
    icon: "receipt_long",
    title: "Other Cost",
    subtitle: "Vendor and non-headcount budget lines",
    path: "/portco/budget/other-cost",
    accent: "#B45309",
    bg: "#FEF3C7",
  },
];

export default function PortcoLandingPage() {
  const navigate = useNavigate();

  return (
    <div style={{
      padding: "40px 32px",
      maxWidth: 900,
      margin: "0 auto",
    }}>
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "#1E293B" }}>
          PortCo Monthly Reporting
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: "0.875rem", color: "#64748B" }}>
          Select a report to view or enter data
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 16,
      }}>
        {REPORTS.map((card) => (
          <button
            key={card.path}
            onClick={() => navigate(card.path)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "20px 18px",
              background: "#fff",
              border: "1px solid #E2E8F0",
              borderRadius: 12,
              cursor: "pointer",
              textAlign: "left",
              transition: "box-shadow 0.15s, border-color 0.15s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 16px rgba(81,45,109,0.12)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = BRAND;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#E2E8F0";
            }}
          >
            {/* Icon */}
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: card.bg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
              <span className="material-icons-round" style={{ fontSize: 22, color: card.accent }}>
                {card.icon}
              </span>
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1E293B", marginBottom: 2 }}>
                {card.title}
              </div>
              <div style={{ fontSize: "0.775rem", color: "#64748B", lineHeight: 1.4 }}>
                {card.subtitle}
              </div>
            </div>

            {/* Arrow */}
            <span className="material-icons-round" style={{ fontSize: 18, color: "#CBD5E1", flexShrink: 0 }}>
              chevron_right
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
