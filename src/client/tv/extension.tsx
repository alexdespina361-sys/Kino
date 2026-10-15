import React from "react";
import { useT } from "../i18n";
import { DownloadIcon, CloseIcon } from "../shared/icons";

export const EXTENSION_ZIP_B64 =
  "UEsDBBQAAAAAAAAAAAD0QPn47gEAAO4BAAANAAAAbWFuaWZlc3QuanNvbnsKICAibWFuaWZlc3RfdmVyc2lvbiI6IDMsCiAgIm5hbWUiOiAiS2lubyBPcmlnaW4gU3RyaXBwZXIiLAogICJ2ZXJzaW9uIjogIjEuMC4wIiwKICAiZGVzY3JpcHRpb24iOiAiVW5ibG9ja3MgZGlyZWN0IHN0cmVhbSBwbGF5YmFjayBvbiBraW5vLjI0LTcucm8gYnkgcmVtb3ZpbmcgdGhlIE9yaWdpbiBoZWFkZXIgYW5kIGVuYWJsaW5nIGZ1bGwgbmF0aXZlIEtpbm8gSFVELiIsCiAgInBlcm1pc3Npb25zIjogWwogICAgImRlY2xhcmF0aXZlTmV0UmVxdWVzdFdpdGhIb3N0QWNjZXNzIgogIF0sCiAgImhvc3RfcGVybWlzc2lvbnMiOiBbCiAgICAiPGFsbF91cmxzPiIKICBdLAogICJkZWNsYXJhdGl2ZV9uZXRfcmVxdWVzdCI6IHsKICAgICJydWxlX3Jlc291cmNlcyI6IFsKICAgICAgewogICAgICAgICJpZCI6ICJzdHJpcF9vcmlnaW4iLAogICAgICAgICJlbmFibGVkIjogdHJ1ZSwKICAgICAgICAicGF0aCI6ICJydWxlcy5qc29uIgogICAgICB9CiAgICBdCiAgfQp9UEsDBBQAAAAAAAAAAACPHmZKqwIAAKsCAAAKAAAAcnVsZXMuanNvblsKICB7CiAgICAiaWQiOiAxLAogICAgInByaW9yaXR5IjogMSwKICAgICJhY3Rpb24iOiB7CiAgICAgICJ0eXBlIjogIm1vZGlmeUhlYWRlcnMiLAogICAgICAicmVxdWVzdEhlYWRlcnMiOiBbCiAgICAgICAgewogICAgICAgICAgImhlYWRlciI6ICJvcmlnaW4iLAogICAgICAgICAgIm9wZXJhdGlvbiI6ICJyZW1vdmUiCiAgICAgICAgfQogICAgICBdLAogICAgICAicmVzcG9uc2VIZWFkZXJzIjogWwogICAgICAgIHsKICAgICAgICAgICJoZWFkZXIiOiAiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luIiwKICAgICAgICAgICJvcGVyYXRpb24iOiAic2V0IiwKICAgICAgICAgICJ2YWx1ZSI6ICIqIgogICAgICAgIH0KICAgICAgXQogICAgfSwKICAgICJjb25kaXRpb24iOiB7CiAgICAgICJpbml0aWF0b3JEb21haW5zIjogWwogICAgICAgICJraW5vLjI0LTcucm8iLAogICAgICAgICJsb2NhbGhvc3QiLAogICAgICAgICIxMjcuMC4wLjEiCiAgICAgIF0sCiAgICAgICJleGNsdWRlZFJlcXVlc3REb21haW5zIjogWwogICAgICAgICJraW5vLjI0LTcucm8iLAogICAgICAgICJsb2NhbGhvc3QiLAogICAgICAgICIxMjcuMC4wLjEiCiAgICAgIF0sCiAgICAgICJyZXNvdXJjZVR5cGVzIjogWwogICAgICAgICJ4bWxodHRwcmVxdWVzdCIsCiAgICAgICAgIm1lZGlhIgogICAgICBdCiAgICB9CiAgfQpdUEsBAhQAFAAAAAAAAAAAAPRA+fjuAQAA7gEAAA0AAAAAAAAAAAAAAAAAAAAAAG1hbmlmZXN0Lmpzb25QSwECFAAUAAAAAAAAAAAAjx5mSqsCAACrAgAACgAAAAAAAAAAAAAAAAAZAgAAcnVsZXMuanNvblBLBQYAAAAAAgACAHMAAADsBAAAAAA=";

/** Triggers a 100% client-side ZIP download of the extension (0 bytes of website server bandwidth). */
export function downloadExtensionZip() {
  const link = document.createElement("a");
  link.href = `data:application/zip;base64,${EXTENSION_ZIP_B64}`;
  link.download = "kino-origin-stripper.zip";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

interface ExtensionModalProps {
  onClose: () => void;
}

export function ExtensionModal({ onClose }: ExtensionModalProps) {
  const t = useT();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(8px)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#16161a",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "16px",
          maxWidth: "520px",
          width: "100%",
          padding: "2rem",
          color: "#fff",
          boxShadow: "0 20px 40px rgba(0,0,0,0.8)",
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "1.25rem",
            right: "1.25rem",
            background: "none",
            border: "none",
            color: "#888",
            cursor: "pointer",
            padding: "0.25rem",
          }}
          aria-label="Close"
        >
          <CloseIcon />
        </button>

        <h2 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 0.5rem 0", color: "#ff3b46" }}>
          {t("tv.extensionTitle")}
        </h2>
        <p style={{ color: "#aaa", fontSize: "0.95rem", lineHeight: 1.5, margin: "0 0 1.5rem 0" }}>
          {t("tv.extensionDesc")}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", marginBottom: "1.75rem" }}>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
            <span style={{ background: "#ff3b46", color: "#fff", width: "22px", height: "22px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 700, flexShrink: 0 }}>1</span>
            <span style={{ fontSize: "0.9rem", color: "#ddd" }}>{t("tv.extensionStep1")}</span>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
            <span style={{ background: "#ff3b46", color: "#fff", width: "22px", height: "22px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 700, flexShrink: 0 }}>2</span>
            <span style={{ fontSize: "0.9rem", color: "#ddd" }}>{t("tv.extensionStep2")}</span>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
            <span style={{ background: "#ff3b46", color: "#fff", width: "22px", height: "22px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 700, flexShrink: 0 }}>3</span>
            <span style={{ fontSize: "0.9rem", color: "#ddd" }}>{t("tv.extensionStep3")}</span>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
            <span style={{ background: "#ff3b46", color: "#fff", width: "22px", height: "22px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 700, flexShrink: 0 }}>4</span>
            <span style={{ fontSize: "0.9rem", color: "#ddd" }}>{t("tv.extensionStep4")}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#ccc",
              borderRadius: "8px",
              padding: "0.6rem 1.2rem",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            {t("common.close")}
          </button>
          <button
            onClick={downloadExtensionZip}
            style={{
              background: "linear-gradient(135deg, #ff3b46 0%, #c40812 100%)",
              border: "none",
              color: "#fff",
              borderRadius: "8px",
              padding: "0.6rem 1.4rem",
              cursor: "pointer",
              fontSize: "0.9rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              boxShadow: "0 4px 14px rgba(255, 59, 70, 0.4)",
            }}
          >
            <DownloadIcon /> {t("tv.downloadAgain")}
          </button>
        </div>
      </div>
    </div>
  );
}
