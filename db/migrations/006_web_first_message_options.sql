with replacements (name, old_body, new_body) as (
  values
    (
      'Primer contacto · nombre + negocio + fuente',
      $old$[[Hola|Buenas]] {nombre}, ¿cómo estás? Soy Joaquín, de jqsystem. Vi {negocio} en {fuente} y [[noté|me di cuenta]] que todavía no tienen página web. Hago webs a medida para negocios, listas en menos de un día. [[Si te interesa|Si te hace sentido]], te cuento los detalles por aquí o [[agendamos|coordinamos]] una reunión corta, como te acomode.$old$,
      $new$[[Hola|Buenas]] {nombre}, ¿cómo estás? Soy Joaquín, de jqsystem. Vi {negocio} en {fuente} y noté que aún no tienen página web; hago sitios a medida para negocios. Si ahora te interesa más mejorar la atención por WhatsApp, también automatizo respuestas y seguimientos. ¿Te cuento un poco más?$new$
    ),
    (
      'Primer contacto · nombre + negocio + Instagram',
      $old$[[Hola|Buenas]] {nombre}, ¿cómo estás? Soy Joaquín, de jqsystem. Vi {negocio} en Instagram y [[noté|me di cuenta]] que todavía no tienen página web. Hago webs a medida para negocios, listas en menos de un día. [[Si te interesa|Si te hace sentido]], te cuento los detalles por aquí o [[agendamos|coordinamos]] una reunión corta, como te acomode.$old$,
      $new$[[Hola|Buenas]] {nombre}, ¿cómo estás? Soy Joaquín, de jqsystem. Vi {negocio} en Instagram y noté que aún no tienen página web; hago sitios a medida para negocios. Si ahora te interesa más mejorar la atención por WhatsApp, también automatizo respuestas y seguimientos. ¿Te cuento un poco más?$new$
    ),
    (
      'Primer contacto · nombre + negocio + rubro',
      $old$[[Hola|Buenas]] {nombre}, ¿cómo estás? Soy Joaquín, de jqsystem. [[Vi|Encontré]] {negocio} y [[noté|me di cuenta]] que todavía no tienen página web. Hago webs a medida para negocios de {rubro}, listas en menos de un día. [[Si te interesa|Si te hace sentido]], te cuento los detalles por aquí o [[agendamos|coordinamos]] una reunión corta, como te acomode.$old$,
      $new$[[Hola|Buenas]] {nombre}, ¿cómo estás? Soy Joaquín, de jqsystem. Vi {negocio}, de {rubro}, y noté que aún no tienen página web; hago sitios a medida para negocios. Si ahora te interesa más mejorar la atención por WhatsApp, también automatizo respuestas y seguimientos. ¿Te cuento un poco más?$new$
    ),
    (
      'Primer contacto · nombre + negocio',
      $old$[[Hola|Buenas]] {nombre}, ¿cómo estás? Soy Joaquín, de jqsystem. [[Vi|Encontré]] {negocio} y [[noté|me di cuenta]] que todavía no tienen página web. Hago webs a medida para negocios, listas en menos de un día. [[Si te interesa|Si te hace sentido]], te cuento los detalles por aquí o [[agendamos|coordinamos]] una reunión corta, como te acomode.$old$,
      $new$[[Hola|Buenas]] {nombre}, ¿cómo estás? Soy Joaquín, de jqsystem. Vi {negocio} y noté que aún no tienen página web; hago sitios a medida para negocios. Si ahora te interesa más mejorar la atención por WhatsApp, también automatizo respuestas y seguimientos. ¿Te cuento un poco más?$new$
    ),
    (
      'Primer contacto · solo negocio',
      $old$[[Hola|Buenas]], ¿cómo estás? Soy Joaquín, de jqsystem. [[Vi|Encontré]] {negocio} y [[noté|me di cuenta]] que todavía no tienen página web. Hago webs a medida para negocios, listas en menos de un día. [[Si les interesa|Si les hace sentido]], les cuento los detalles por aquí o [[agendamos|coordinamos]] una reunión corta, como les acomode.$old$,
      $new$[[Hola|Buenas]], soy Joaquín, de jqsystem. Vi {negocio} y quería comentarles que hago páginas web a medida. Si ahora les interesa más mejorar la atención por WhatsApp, también automatizo respuestas y seguimientos. ¿Les cuento un poco más?$new$
    ),
    (
      'Primer contacto · solo nombre',
      $old$[[Hola|Buenas]] {nombre}, ¿cómo estás? Soy Joaquín, de jqsystem. [[Vi|Encontré]] tu negocio y [[noté|me di cuenta]] que todavía no tiene página web. Hago webs a medida para negocios, listas en menos de un día. [[Si te interesa|Si te hace sentido]], te cuento los detalles por aquí o [[agendamos|coordinamos]] una reunión corta, como te acomode.$old$,
      $new$[[Hola|Buenas]] {nombre}, ¿cómo estás? Soy Joaquín, de jqsystem. Vi tu negocio y quería contarte que hago páginas web a medida. Si ahora te interesa más mejorar la atención por WhatsApp, también automatizo respuestas y seguimientos. ¿Te cuento un poco más?$new$
    ),
    (
      'Primer contacto · sin datos',
      $old$[[Hola|Buenas]], ¿cómo estás? Soy Joaquín, de jqsystem. [[Vi|Encontré]] su negocio y [[noté|me di cuenta]] que todavía no tienen página web. Hago webs a medida para negocios, listas en menos de un día. [[Si les interesa|Si les hace sentido]], les cuento los detalles por aquí o [[agendamos|coordinamos]] una reunión corta, como les acomode.$old$,
      $new$[[Hola|Buenas]], soy Joaquín, de jqsystem. Ayudo a negocios con páginas web a medida. Si ahora les interesa más mejorar la atención por WhatsApp, también automatizo respuestas y seguimientos. ¿Les cuento un poco más?$new$
    )
)
update templates t
set body = r.new_body, updated_at = now()
from replacements r
where t.name = r.name
  and t.campaign = 'web_sales'
  and t.step = 1
  and t.kind = 'normal'
  and t.body = r.old_body;
