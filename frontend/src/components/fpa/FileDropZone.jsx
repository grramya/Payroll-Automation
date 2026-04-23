import { useRef, useState } from "react";
import { Box, Typography, alpha } from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";

export default function FileDropZone({ label, accept, file, onFile }) {
  const inputRef   = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  };
  const handleKey = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); }
  };

  const fileSize = file ? (file.size / 1024).toFixed(1) + " KB" : null;

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={
        file
          ? `${label}: ${file.name} selected. Press Enter to change.`
          : `${label}: Click or drag and drop an .xlsx file.`
      }
      onClick={() => inputRef.current?.click()}
      onKeyDown={handleKey}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={!file && !dragging ? "drop-pulse" : ""}
      sx={{
        position: "relative",
        border: "2px dashed",
        borderColor: dragging ? "primary.main" : file ? "success.main" : "#CBD5E1",
        borderRadius: 3,
        p: 3,
        cursor: "pointer",
        textAlign: "center",
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        bgcolor: dragging
          ? alpha("#2563EB", 0.04)
          : file
          ? alpha("#059669", 0.04)
          : "#FAFAFA",
        outline: "none",
        transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
        "&:focus-visible": {
          outline: "3px solid",
          outlineColor: "primary.main",
          outlineOffset: 3,
        },
        "&:hover": {
          borderColor: file ? "success.main" : "primary.main",
          bgcolor: file ? alpha("#059669", 0.04) : alpha("#2563EB", 0.04),
        },
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
      />

      {file ? (
        <>
          <Box
            sx={{
              width: 48, height: 48, borderRadius: 2.5,
              bgcolor: alpha("#059669", 0.1),
              display: "flex", alignItems: "center", justifyContent: "center",
              mb: 0.5,
            }}
          >
            <InsertDriveFileIcon sx={{ fontSize: 24, color: "success.main" }} aria-hidden="true" />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <CheckCircleIcon sx={{ fontSize: 14, color: "success.main" }} aria-hidden="true" />
            <Typography variant="body2" fontWeight={600} color="success.dark">
              {file.name}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {fileSize} · Click to replace
          </Typography>
        </>
      ) : (
        <>
          <Box
            sx={{
              width: 48, height: 48, borderRadius: 2.5,
              bgcolor: dragging ? alpha("#2563EB", 0.1) : "#F1F5F9",
              display: "flex", alignItems: "center", justifyContent: "center",
              mb: 0.5,
              transition: "all 0.2s",
            }}
          >
            <CloudUploadIcon
              sx={{ fontSize: 24, color: dragging ? "primary.main" : "#94A3B8", transition: "color 0.2s" }}
              aria-hidden="true"
            />
          </Box>
          <Typography variant="body2" fontWeight={600} color="text.primary">
            {dragging ? "Drop file here" : "Click or drag & drop"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            .xlsx files only
          </Typography>
        </>
      )}
    </Box>
  );
}
