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


function acortarUrl(
  urlLarga
) {

  /*
   * is.gd no permite fetch() directo desde GitHub Pages por CORS.
   * Su API sí soporta JSONP mediante el parámetro callback,
   * que está pensado para datos entre dominios.
   */
  return new Promise(
    (resolve, reject) => {

      const callbackName =
        `isgdCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;


      const script =
        document.createElement(
          "script"
        );


      const limpiar = () => {

        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }


        try {
          delete window[callbackName];
        } catch (_) {
          window[callbackName] = undefined;
        }

      };


      const timeout =
        setTimeout(
          () => {

            limpiar();


            reject(
              new Error(
                "El acortador tardó demasiado en responder."
              )
            );

          },
          12000
        );


      window[callbackName] =
        data => {

          clearTimeout(
            timeout
          );


          limpiar();


          if (
            data?.shorturl
          ) {

            resolve(
              data.shorturl
            );

            return;

          }


          reject(
            new Error(
              data?.errormessage ||
              "No se pudo acortar el enlace."
            )
          );

        };


      script.onerror =
        () => {

          clearTimeout(
            timeout
          );


          limpiar();


          reject(
            new Error(
              "No se pudo conectar con el acortador."
            )
          );

        };


      const endpoint =
        "https://is.gd/create.php" +
        `?format=json` +
        `&callback=${encodeURIComponent(callbackName)}` +
        `&url=${encodeURIComponent(urlLarga)}`;


      script.src =
        endpoint;


      document.head.appendChild(
        script
      );

    }
  );

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

    boton.disabled =
      true;


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
      "No se pudo generar el enlace corto. Intenta nuevamente.",
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
