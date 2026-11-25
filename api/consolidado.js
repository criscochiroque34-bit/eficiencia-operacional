// api/consolidado.js
// Genera el Excel del Consolidador en el servidor: encabezado con color +
// fijo (freeze panes), bordes y autofiltro en DETALLE, encabezado con
// color en RESUMEN. La librería xlsx que corre en el navegador no
// garantiza escribir ese formato al exportar — por eso el archivo final
// se arma acá con una librería completa (exceljs) y se descarga ya listo.

import ExcelJS from "exceljs";

const MAX_FILAS = 200000; // límite de cordura, no debería acercarse nunca

function anchoColumna(valores) {
  let max = 10;
  valores.forEach((v) => {
    if (v == null) return;
    max = Math.max(max, String(v).length);
  });
  return Math.min(Math.max(max + 2, 10), 42);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  try {
    const { fileName, headers, filas, resumen } = req.body || {};

    if (!Array.isArray(headers) || !headers.length || !Array.isArray(filas)) {
      res.status(400).json({ error: "Datos inválidos: faltan encabezados o filas" });
      return;
    }
    if (filas.length > MAX_FILAS) {
      res.status(400).json({ error: "Demasiadas filas para exportar" });
      return;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Eficiencia Operacional";
    wb.created = new Date();

    const wsDetalle = wb.addWorksheet("DETALLE", { views: [{ state: "frozen", ySplit: 1 }] });
    wsDetalle.addRow(headers);
    filas.forEach((f) => wsDetalle.addRow(f));

    const headerRow = wsDetalle.getRow(1);
    headerRow.height = 20;
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C6FFF" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "thin", color: { argb: "FF5A4FD6" } },
        left: { style: "thin", color: { argb: "FF5A4FD6" } },
        bottom: { style: "thin", color: { argb: "FF5A4FD6" } },
        right: { style: "thin", color: { argb: "FF5A4FD6" } },
      };
    });
    wsDetalle.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

    for (let r = 2; r <= filas.length + 1; r++) {
      wsDetalle.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE0E0E0" } },
          left: { style: "thin", color: { argb: "FFE0E0E0" } },
          bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
          right: { style: "thin", color: { argb: "FFE0E0E0" } },
        };
      });
    }

    wsDetalle.columns.forEach((col, i) => {
      col.width = anchoColumna([headers[i], ...filas.map((f) => f[i])]);
    });

    if (Array.isArray(resumen) && resumen.length) {
      const wsResumen = wb.addWorksheet("RESUMEN", { views: [{ state: "frozen", ySplit: 1 }] });
      resumen.forEach((row) => wsResumen.addRow(row));
      const rHeader = wsResumen.getRow(1);
      rHeader.height = 20;
      rHeader.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00C896" } };
        cell.font = { bold: true, color: { argb: "FF07070F" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
      wsResumen.getColumn(1).width = 34;
      wsResumen.getColumn(2).width = 22;
    }

    const buffer = await wb.xlsx.writeBuffer();
    const nombreSeguro = (fileName || "Consolidado").replace(/[\\/:*?"<>|]/g, "_");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreSeguro}.xlsx"`);
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error("Error en /api/consolidado:", err);
    res.status(500).json({ error: "Error generando el Excel" });
  }
}
