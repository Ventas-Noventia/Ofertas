const WHATSAPP_GENERAL =
  "525516792785";


const $ =
  selector =>
    document.querySelector(selector);


let archivoFoto =
  null;


let fotoLocal =
  "";


let publicacionActual =
  null;


function moneda(valor) {

  return Number(valor || 0)
    .toLocaleString(
      "es-MX",
      {
        style: "currency",
        currency: "MXN"
      }
    );

}


function mostrarEstado(
  texto,
  error = false
) {

  const elemento =
    $("#mensajeEstado");


  if (!elemento) return;


  elemento.textContent =
    texto;


  elemento.className =
    error
      ? "status error"
      : "status";

}


function construirMensajeWhatsapp({
  producto,
  precio,
  vendedor
}) {

  return [
    "Hola 👋",
    "",
    "Quiero comprar este producto:",
    "",
    `Producto: ${producto}`,
    `Precio: ${moneda(precio)}`,
    `Publicado por: ${vendedor}`,
    "",
    "¿Me apoyan con la disponibilidad?"
  ].join("\n");

}


function construirLinkWhatsapp({
  producto,
  precio,
  vendedor
}) {

  const mensaje =
    construirMensajeWhatsapp({
      producto,
      precio,
      vendedor
    });


  return (
    `https://wa.me/${WHATSAPP_GENERAL}` +
    `?text=${encodeURIComponent(mensaje)}`
  );

}


async function acortarUrl(
  urlLarga
) {

  const respuesta =
    await fetch(
      "https://noventia-whatsapptu-cuentaworkersdev.ing-ed-mtz-leon.workers.dev/",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            url: urlLarga
          })
      }
    );


  let datos = null;

  try {
    datos =
      await respuesta.json();
  } catch (_) {
    throw new Error(
      "El backend respondió con un formato inválido."
    );
  }


  if (
    !respuesta.ok ||
    !datos?.ok ||
    !datos?.url
  ) {

    throw new Error(
      datos?.error ||
      "No se pudo acortar el enlace."
    );

  }


  return datos.url;

}


function textoPublicacion(
  publicacion
) {

  return [
    `🛍️ ${publicacion.producto}`,
    `💰 ${moneda(publicacion.precio)}`,
    "",
    "¿Te interesa este producto?",
    "Da clic aquí 👇",
    publicacion.linkCorto
  ].join("\n");

}


async function generarPublicacion() {

  const producto =
    $("#nombreProducto")
      ?.value
      .trim() || "";


  const precio =
    Number(
      $("#precioProducto")
        ?.value
    );


  const encargada =
    $("#encargada")
      ?.value || "";


  if (!archivoFoto) {

    mostrarEstado(
      "Agrega una foto del producto.",
      true
    );

    return;

  }


  if (!producto) {

    mostrarEstado(
      "Escribe el nombre del producto.",
      true
    );

    $("#nombreProducto")
      ?.focus();

    return;

  }


  if (
    !Number.isFinite(precio) ||
    precio <= 0
  ) {

    mostrarEstado(
      "Escribe un precio válido.",
      true
    );

    $("#precioProducto")
      ?.focus();

    return;

  }


  if (!encargada) {

    mostrarEstado(
      "Selecciona la encargada.",
      true
    );

    $("#encargada")
      ?.focus();

    return;

  }


  const [
    vendedor,
    encargadaNombre
  ] =
    encargada.split("|");


  const boton =
    $("#btnGenerar");


  try {

    if (boton) {
      boton.disabled = true;
    }


    mostrarEstado(
      "Generando enlace..."
    );


    const linkWhatsapp =
      construirLinkWhatsapp({
        producto,
        precio,
        vendedor
      });


    const linkCorto =
      await acortarUrl(
        linkWhatsapp
      );


    publicacionActual = {
      producto,
      precio,
      vendedor,
      encargadaNombre,
      linkWhatsapp,
      linkCorto
    };


    $("#resultadoFoto").src =
      fotoLocal;


    $("#resultadoNombre")
      .textContent =
        producto;


    $("#resultadoPrecio")
      .textContent =
        moneda(precio);


    $("#resultadoLink")
      .textContent =
        linkCorto;


    $("#resultado")
      ?.classList.remove(
        "hidden"
      );


    localStorage.setItem(
      "encargadaPublicaciones",
      encargada
    );


    mostrarEstado(
      "Publicación lista para compartir."
    );


  } catch (error) {

    console.error(error);


    mostrarEstado(
      error?.message ||
      "No se pudo generar el enlace corto.",
      true
    );


  } finally {

    if (boton) {
      boton.disabled = false;
    }

  }

}


async function compartirPublicacion() {

  if (!publicacionActual) {
    return;
  }


  const datos = {

    title:
      publicacionActual.producto,

    text:
      textoPublicacion(
        publicacionActual
      )

  };


  if (
    archivoFoto &&
    navigator.canShare &&
    navigator.canShare({
      files: [archivoFoto]
    })
  ) {

    datos.files =
      [archivoFoto];

  }


  try {

    if (navigator.share) {

      await navigator.share(
        datos
      );

      return;

    }


    await navigator.clipboard
      .writeText(
        datos.text
      );


    mostrarEstado(
      "Texto copiado. Pégalo en WhatsApp."
    );


  } catch (error) {

    if (
      error?.name !==
      "AbortError"
    ) {

      console.error(error);


      mostrarEstado(
        "No se pudo compartir la publicación.",
        true
      );

    }

  }

}


async function copiarPublicacion() {

  if (!publicacionActual) {
    return;
  }


  try {

    await navigator.clipboard
      .writeText(
        textoPublicacion(
          publicacionActual
        )
      );


    mostrarEstado(
      "Publicación copiada."
    );


  } catch (error) {

    console.error(error);


    mostrarEstado(
      "No se pudo copiar la publicación.",
      true
    );

  }

}


function nuevaPublicacion() {

  if ($("#foto")) {
    $("#foto").value = "";
  }


  if ($("#nombreProducto")) {
    $("#nombreProducto").value = "";
  }


  if ($("#precioProducto")) {
    $("#precioProducto").value = "";
  }


  archivoFoto =
    null;


  if (fotoLocal) {

    URL.revokeObjectURL(
      fotoLocal
    );

  }


  fotoLocal =
    "";


  $("#previewFoto")
    ?.removeAttribute(
      "src"
    );


  if ($("#previewFoto")) {

    $("#previewFoto")
      .style.display =
        "none";

  }


  $("#resultado")
    ?.classList.add(
      "hidden"
    );


  publicacionActual =
    null;


  mostrarEstado("");


  $("#nombreProducto")
    ?.focus();

}


function inicializarGenerador() {

  $("#foto")
    ?.addEventListener(
      "change",
      event => {

        archivoFoto =
          event.target.files?.[0] ||
          null;


        if (!archivoFoto) {
          return;
        }


        if (fotoLocal) {

          URL.revokeObjectURL(
            fotoLocal
          );

        }


        fotoLocal =
          URL.createObjectURL(
            archivoFoto
          );


        $("#previewFoto").src =
          fotoLocal;


        $("#previewFoto")
          .style.display =
            "block";

      }
    );


  $("#btnGenerar")
    ?.addEventListener(
      "click",
      generarPublicacion
    );


  $("#btnCompartir")
    ?.addEventListener(
      "click",
      compartirPublicacion
    );


  $("#btnCopiar")
    ?.addEventListener(
      "click",
      copiarPublicacion
    );


  $("#btnNuevo")
    ?.addEventListener(
      "click",
      nuevaPublicacion
    );


  const encargadaGuardada =
    localStorage.getItem(
      "encargadaPublicaciones"
    );


  if (encargadaGuardada) {

    const existe =
      [...$("#encargada").options]
        .some(
          option =>
            option.value ===
            encargadaGuardada
        );


    if (existe) {

      $("#encargada").value =
        encargadaGuardada;

    }

  }

}


inicializarGenerador();
