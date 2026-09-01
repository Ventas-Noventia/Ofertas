let cargaReportes = null;

export function cargarVistasReporte({
  exportarCaja,
  imprimirCaja,
  obtenerMovimientosCaja,
  obtenerRangoCaja,
  fechaEnRango,
  moneda,
  metodoPagoTexto
}) {
  if (cargaReportes) return cargaReportes;

  cargaReportes = cargarContenido({
    exportarCaja,
    imprimirCaja,
    obtenerMovimientosCaja,
    obtenerRangoCaja,
    fechaEnRango,
    moneda,
    metodoPagoTexto
  }).catch(error => {
    cargaReportes = null;
    throw error;
  });

  return cargaReportes;
}

async function cargarContenido({
  exportarCaja,
  imprimirCaja,
  obtenerMovimientosCaja,
  obtenerRangoCaja,
  fechaEnRango,
  moneda,
  metodoPagoTexto
}) {
  const contenedor = document.querySelector(
    "#contenidoReportes"
  );

  if (!contenedor) {
    throw new Error(
      "No existe el contenedor #contenidoReportes."
    );
  }

  const archivos = [
    "corte-caja.html",
    "gastos.html",
    "cuadre-general.html"
  ];

  const contenidos = await Promise.all(
    archivos.map(async archivo => {
      const url = new URL(archivo, import.meta.url);

      const respuesta = await fetch(url, {
        cache: "no-cache"
      });

      if (!respuesta.ok) {
        throw new Error(
          `No se pudo cargar ${archivo}: HTTP ${respuesta.status}`
        );
      }

      return respuesta.text();
    })
  );

  const plantilla = document.createElement("template");
  plantilla.innerHTML = contenidos.join("\n");

  const elementosRequeridos = [
    "panelCorteCaja",
    "panelGastosCaja",
    "panelCuadreCaja",
    "cajaTotal",
    "cajaDevoluciones",
    "cajaNeto",
    "cajaEfectivo",
    "cajaTransferencia",
    "cajaMovimientos",
    "tablaCaja",
    "sinMovimientosCaja",
    "btnExportarCaja",
    "btnImprimirCaja"
  ];

  for (const id of elementosRequeridos) {
    if (!plantilla.content.querySelector(`#${id}`)) {
      throw new Error(
        `Falta el elemento #${id} en los HTML de reportes.`
      );
    }
  }

  contenedor.replaceChildren(plantilla.content);

  contenedor
    .querySelector("#btnExportarCaja")
    .addEventListener("click", exportarCaja);

  contenedor
    .querySelector("#btnImprimirCaja")
    .addEventListener("click", imprimirCaja);

  const {
    inicializarGastos,
    obtenerGastosRegistrados,
    aplicarFiltroGastos,
    suscribirCambiosGastos
  } = await import("./gastos.js?v=2");

  inicializarGastos();

  const { inicializarCuadre } = await import(
    "./cuadre.js?v=1"
  );

  inicializarCuadre({
    obtenerMovimientosCaja,
    obtenerRangoCaja,
    fechaEnRango,
    moneda,
    metodoPagoTexto,
    obtenerGastosRegistrados,
    aplicarFiltroGastos,
    suscribirCambiosGastos
  });
}
