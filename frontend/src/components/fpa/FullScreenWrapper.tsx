import { useState, forwardRef } from "react";
import type { ReactNode } from "react";
import {
  Box, IconButton, Tooltip, Dialog, AppBar,
  Toolbar, Typography, Slide, alpha,
} from "@mui/material";
import type { SlideProps } from "@mui/material";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import CloseIcon from "@mui/icons-material/Close";

const Transition = forwardRef<unknown, SlideProps>(function Transition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

interface Props {
  title?: string;
  children: ReactNode;
  fullContent?: ReactNode;
}

export default function FullScreenWrapper({ title, children, fullContent }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Box sx={{ position: "relative" }}>
        <Tooltip title="Full screen" placement="left">
          <IconButton
            size="small"
            aria-label={`Open ${title ?? "preview"} in full screen`}
            onClick={() => setOpen(true)}
            sx={{
              position: "absolute", top: 10, right: 10, zIndex: 50,
              bgcolor: "background.paper",
              border: "1px solid #E2E8F0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              width: 30, height: 30,
              "&:hover": {
                bgcolor: "#F1F5F9",
                borderColor: "#CBD5E1",
                boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
              },
            }}
          >
            <FullscreenIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        {children}
      </Box>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="xl"
        fullWidth
        slots={{ transition: Transition }}
        aria-label={`${title ?? "Preview"} — full screen`}
        slotProps={{ paper: { sx: { bgcolor: "#F8FAFC", maxHeight: "90vh", display: "flex", flexDirection: "column" } } }}
      >
        <AppBar
          elevation={0}
          sx={{
            position: "relative",
            bgcolor: "#0F172A",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
          component="header"
        >
          <Toolbar sx={{ minHeight: "54px !important" }}>
            <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700, color: "white", fontSize: "0.9rem" }}>
              {title ?? "Preview"}
            </Typography>
            <Tooltip title="Close">
              <IconButton
                color="inherit"
                onClick={() => setOpen(false)}
                aria-label="Close full screen view"
                sx={{ "&:hover": { bgcolor: alpha("#fff", 0.1) } }}
              >
                <CloseIcon />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>
        <Box sx={{ flex: 1, overflow: "auto", p: 2.5 }}>
          {fullContent ?? children}
        </Box>
      </Dialog>
    </>
  );
}
