alter table contacts
  add column campaign text not null default 'web_sales'
    check (campaign in ('web_sales', 'whatsapp_automation'));

alter table templates
  add column campaign text not null default 'web_sales'
    check (campaign in ('web_sales', 'whatsapp_automation'));

alter table import_batches
  add column campaign text not null default 'web_sales'
    check (campaign in ('web_sales', 'whatsapp_automation'));

insert into templates (step, kind, campaign, name, body, requires, weight) values
(1,'normal','whatsapp_automation','Automatización · nombre + negocio', $t$[[Hola|Buenas]] {nombre}, soy Joaquín. Vi {negocio} y su página web. Estoy ofreciendo soluciones para automatizar la atención y los seguimientos por WhatsApp, adaptadas a cada negocio. [[¿Te puedo contar|¿Te interesa que te cuente]] brevemente cómo podría funcionar para ustedes?$t$, '{}', 3),
(1,'normal','whatsapp_automation','Automatización · solo negocio', $t$[[Hola|Buenas]], soy Joaquín. Vi {negocio} y su página web. Estoy ofreciendo soluciones para automatizar la atención y los seguimientos por WhatsApp, adaptadas a cada negocio. [[¿Les puedo contar|¿Les interesa que les cuente]] brevemente cómo podría funcionar para ustedes?$t$, '{}', 2),
(1,'normal','whatsapp_automation','Automatización · solo nombre', $t$[[Hola|Buenas]] {nombre}, soy Joaquín. Estoy ofreciendo soluciones para automatizar la atención y los seguimientos por WhatsApp de negocios que ya tienen página web. [[¿Te puedo contar|¿Te interesa que te cuente]] brevemente cómo podría funcionar?$t$, '{}', 2),
(1,'normal','whatsapp_automation','Automatización · sin datos', $t$[[Hola|Buenas]], soy Joaquín. Estoy ofreciendo soluciones para automatizar la atención y los seguimientos por WhatsApp de negocios que ya tienen página web. [[¿Les puedo contar|¿Les interesa que les cuente]] brevemente cómo podría funcionar?$t$, '{}', 1),

(2,'normal','whatsapp_automation','Automatización · seguimiento 1 · nombre + negocio', $t$[[Hola|Buenas]] {nombre}, te escribo de nuevo por si alcanzaste a ver mi mensaje. Para {negocio}, podríamos revisar qué consultas y seguimientos se pueden ordenar o automatizar por WhatsApp. [[¿Te acomoda conversar|¿Te interesa conversarlo]] por aquí?$t$, '{}', 3),
(2,'normal','whatsapp_automation','Automatización · seguimiento 1 · solo nombre', $t$[[Hola|Buenas]] {nombre}, te escribo de nuevo por si alcanzaste a ver mi mensaje. Podemos revisar qué consultas y seguimientos se pueden ordenar o automatizar por WhatsApp en tu negocio. [[¿Te acomoda conversar|¿Te interesa conversarlo]] por aquí?$t$, '{}', 2),
(2,'normal','whatsapp_automation','Automatización · seguimiento 1 · solo negocio', $t$[[Hola|Buenas]], les escribo de nuevo por si alcanzaron a ver mi mensaje. Podemos revisar qué consultas y seguimientos se pueden ordenar o automatizar por WhatsApp en {negocio}. [[¿Les acomoda conversar|¿Les interesa conversarlo]] por aquí?$t$, '{}', 2),
(2,'normal','whatsapp_automation','Automatización · seguimiento 1 · sin datos', $t$[[Hola|Buenas]], les escribo de nuevo por si alcanzaron a ver mi mensaje. Podemos revisar qué consultas y seguimientos se pueden ordenar o automatizar por WhatsApp para su negocio. [[¿Les acomoda conversar|¿Les interesa conversarlo]] por aquí?$t$, '{}', 1),

(3,'normal','whatsapp_automation','Automatización · seguimiento 2 · nombre + negocio', $t$[[Hola|Buenas]] {nombre}, una idea es identificar las preguntas frecuentes de {negocio} y definir qué seguimientos conviene automatizar por WhatsApp, manteniendo el trato cercano. [[Si te parece|Si te interesa]], conversamos y vemos si tiene sentido para ustedes.$t$, '{}', 3),
(3,'normal','whatsapp_automation','Automatización · seguimiento 2 · solo nombre', $t$[[Hola|Buenas]] {nombre}, una idea es identificar las preguntas frecuentes de tu negocio y definir qué seguimientos conviene automatizar por WhatsApp, manteniendo el trato cercano. [[Si te parece|Si te interesa]], conversamos y vemos si tiene sentido para ustedes.$t$, '{}', 2),
(3,'normal','whatsapp_automation','Automatización · seguimiento 2 · solo negocio', $t$[[Hola|Buenas]], una idea es identificar las preguntas frecuentes de {negocio} y definir qué seguimientos conviene automatizar por WhatsApp, manteniendo el trato cercano. [[Si les parece|Si les interesa]], conversamos y vemos si tiene sentido para ustedes.$t$, '{}', 2),
(3,'normal','whatsapp_automation','Automatización · seguimiento 2 · sin datos', $t$[[Hola|Buenas]], una idea es identificar las preguntas frecuentes de su negocio y definir qué seguimientos conviene automatizar por WhatsApp, manteniendo el trato cercano. [[Si les parece|Si les interesa]], conversamos y vemos si tiene sentido para ustedes.$t$, '{}', 1),

(4,'normal','whatsapp_automation','Automatización · cierre · nombre + negocio', $t$[[Hola|Buenas]] {nombre}, este es mi último mensaje por ahora. Si más adelante quieren revisar cómo automatizar la atención y los seguimientos por WhatsApp de {negocio}, quedo disponible. Si prefieres que no te escriba más, dímelo y listo. [[¡Mucho éxito!|¡Que les vaya muy bien!]]$t$, '{}', 3),
(4,'normal','whatsapp_automation','Automatización · cierre · solo nombre', $t$[[Hola|Buenas]] {nombre}, este es mi último mensaje por ahora. Si más adelante quieres revisar cómo automatizar la atención y los seguimientos por WhatsApp de tu negocio, quedo disponible. Si prefieres que no te escriba más, dímelo y listo. [[¡Mucho éxito!|¡Que te vaya muy bien!]]$t$, '{}', 2),
(4,'normal','whatsapp_automation','Automatización · cierre · solo negocio', $t$[[Hola|Buenas]], este es mi último mensaje por ahora. Si más adelante quieren revisar cómo automatizar la atención y los seguimientos por WhatsApp de {negocio}, quedo disponible. Si prefieren que no les escriba más, díganmelo y listo. [[¡Mucho éxito!|¡Que les vaya muy bien!]]$t$, '{}', 2),
(4,'normal','whatsapp_automation','Automatización · cierre · sin datos', $t$[[Hola|Buenas]], este es mi último mensaje por ahora. Si más adelante quieren revisar cómo automatizar la atención y los seguimientos por WhatsApp de su negocio, quedo disponible. Si prefieren que no les escriba más, díganmelo y listo. [[¡Mucho éxito!|¡Que les vaya muy bien!]]$t$, '{}', 1);
