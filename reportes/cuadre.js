let iniciado = false;
let contexto = null;
let filas = [];
let movimientosFiltrados = [];
let gastosFiltrados = [];

const $ = selector => document.querySelector(selector);
const aCentavos = valor => Math.round(Number(valor || 0) * 100);

export function inicializarCuadre(nuevoContexto) {
  if (iniciado) return;
  iniciado = true;
  contexto = nuevoContexto;

  for (const id of ["periodoCaja", "fechaCaja", "semanaCaja", "mesCaja", "metodoCaja"]) {
    $("#" + id)?.addEventListener("change", actualizarCuadre);
  }

  $("#btnAplicarCaja")?.addEventListener("click", actualizarCuadre);
  $("#btnExportarCuadre")?.addEventListener("click", exportarCuadre);
  document.querySelector('[data-reporte="cuadre"]')
    ?.addEventListener("click", actualizarCuadre);

  contexto.suscribirCambiosGastos(actualizarCuadre);
  actualizarCuadre();
}

export function actualizarCuadre() {
  if (!contexto) return;

  const rango = contexto.obtenerRangoCaja();
  if (!rango) return;

  const metodo = $("#metodoCaja").value;

  contexto.aplicarFiltroGastos({
    rango,
    metodo,
    fechaEnRango: contexto.fechaEnRango
  });

  movimientosFiltrados = contexto.obtenerMovimientosCaja().filter(movimiento =>
    movimiento.tipo !== "CANCELACION" &&
    contexto.fechaEnRango(movimiento.fecha, rango.inicio, rango.fin) &&
    (!metodo || movimiento.metodo === metodo)
  );

  gastosFiltrados = contexto.obtenerGastosRegistrados().filter(gasto => {
    const fecha = gasto.creadoEn?.toDate?.();
    if (!fecha) return false;

    return contexto.fechaEnRango(
      fechaLocalISO(fecha),
      rango.inicio,
      rango.fin
    ) && (!metodo || gasto.metodo === metodo);
  });

  filas = crearFilas(movimientosFiltrados, gastosFiltrados, metodo);
  renderCuadre();
}

function crearFilas(movimientos, gastos, metodoSeleccionado) {
  const grupos = metodoSeleccionado
    ? [[metodoSeleccionado, textoMetodo(metodoSeleccionado)]]
    : [
        ["EFECTIVO", "Efectivo"],
        ["TRANSFERENCIA", "Transferencia"],
        ["OTROS", "Otros métodos / ajustes"]
      ];

  const resultado = grupos.map(([metodo, etiqueta]) => {
    const coincide = item => metodo === "OTROS"
      ? !["EFECTIVO", "TRANSFERENCIA"].includes(item.metodo)
      : item.metodo === metodo;

    const ingresos = sumarMovimientos(
      movimientos.filter(m => m.tipo === "INGRESO" && coincide(m))
    );

    const devoluciones = Math.abs(sumarMovimientos(
      movimientos.filter(m => m.tipo === "DEVOLUCION" && coincide(m))
    ));

    const gastoCentavos = gastos
      .filter(coincide)
      .reduce((total, gasto) => total + Number(gasto.montoCentavos || 0), 0);

    const saldoCentavos =
      aCentavos(ingresos) - aCentavos(devoluciones) - gastoCentavos;

    return {
      metodo: etiqueta,
      ingresos,
      devoluciones,
      gastos: gastoCentavos / 100,
      saldo: saldoCentavos / 100
    };
  });

  const totalCentavos = resultado.reduce((total, fila) => ({
    ingresos: total.ingresos + aCentavos(fila.ingresos),
    devoluciones: total.devoluciones + aCentavos(fila.devoluciones),
    gastos: total.gastos + aCentavos(fila.gastos),
    saldo: total.saldo + aCentavos(fila.saldo)
  }), { ingresos: 0, devoluciones: 0, gastos: 0, saldo: 0 });

  resultado.push({
    metodo: "Total",
    ingresos: totalCentavos.ingresos / 100,
    devoluciones: totalCentavos.devoluciones / 100,
    gastos: totalCentavos.gastos / 100,
    saldo: totalCentavos.saldo / 100
  });

  return resultado;
}

function renderCuadre() {
  const total = filas.at(-1) || {
    ingresos: 0, devoluciones: 0, gastos: 0, saldo: 0
  };

  $("#cuadreIngresos").textContent = contexto.moneda(total.ingresos);
  $("#cuadreDevoluciones").textContent = contexto.moneda(total.devoluciones);
  $("#cuadreGastos").textContent = contexto.moneda(total.gastos);
  $("#cuadreSaldo").textContent = contexto.moneda(total.saldo);
  $("#cuadreSaldo").classList.toggle("return-amount", total.saldo < 0);

  $("#tablaCuadre").innerHTML = filas.map(fila => `
    <tr>
      <td>${fila.metodo}</td>
      <td>${contexto.moneda(fila.ingresos)}</td>
      <td>${contexto.moneda(fila.devoluciones)}</td>
      <td>${contexto.moneda(fila.gastos)}</td>
      <td class="${fila.saldo < 0 ? "return-amount" : ""}">
        ${contexto.moneda(fila.saldo)}
      </td>
    </tr>
  `).join("");
}

function exportarCuadre() {
  actualizarCuadre();

  if (!globalThis.XLSX) {
    alert("No se pudo cargar el componente de Excel.");
    return;
  }

  const rango = contexto.obtenerRangoCaja();
  const libro = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    libro,
    XLSX.utils.json_to_sheet(filas.map(fila => ({
      "Tipo de pago": fila.metodo,
      Ingresos: fila.ingresos,
      Devoluciones: fila.devoluciones,
      Gastos: fila.gastos,
      Saldo: fila.saldo
    }))),
    "Resumen"
  );

  XLSX.utils.book_append_sheet(
    libro,
    XLSX.utils.json_to_sheet(movimientosFiltrados.map(m => ({
      Fecha: m.fecha,
      Tipo: m.tipo === "DEVOLUCION" ? "Devolución" : "Ingreso",
      Folio: m.folio,
      Cliente: m.cliente,
      Método: m.tipo === "INGRESO" ? contexto.metodoPagoTexto(m.metodo) : "",
      Concepto: m.concepto,
      Importe: m.importe,
      Vendedor: m.vendedor
    }))),
    "Movimientos de caja"
  );

  XLSX.utils.book_append_sheet(
    libro,
    XLSX.utils.json_to_sheet(gastosFiltrados.map(gasto => ({
      ID: gasto.id,
      Fecha: gasto.creadoEn?.toDate?.().toLocaleString("es-MX") || "",
      Concepto: gasto.concepto,
      Método: contexto.metodoPagoTexto(gasto.metodo),
      Monto: Number(gasto.montoCentavos || 0) / 100,
      Comprobante: gasto.tieneComprobante
        ? "Disponible en el sistema"
        : "Sin comprobante"
    }))),
    "Gastos"
  );

  XLSX.writeFile(libro, `cuadre-general-${rango.etiqueta}.xlsx`);
}

function sumarMovimientos(lista) {
  return lista.reduce(
    (total, movimiento) => total + Number(movimiento.importe || 0),
    0
  );
}

function textoMetodo(metodo) {
  return metodo === "EFECTIVO" ? "Efectivo" : "Transferencia";
}

function fechaLocalISO(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}
