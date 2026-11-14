import { ImageResponse } from "next/og";
import { ru } from "@/lib/i18n/ru";
export const alt = "Учебная платформа для стоматологов";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "#f3f6f5",
        padding: 90,
        color: "#15242c",
        fontSize: 64,
        fontWeight: 700,
      }}
    >
      <div style={{ display: "flex" }}>{ru.brand}</div>
      <div
        style={{
          display: "flex",
          fontSize: 34,
          fontWeight: 400,
          marginTop: 32,
        }}
      >
        Методички · тесты · повторение
      </div>
    </div>,
    size,
  );
}
