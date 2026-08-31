# CRM — Leads module (code showcase)

Extracto **curado y de solo lectura** del módulo de **Leads** de un CRM comercial
que construí (una herramienta interna de gestión comercial para una empresa de
staff augmentation). Muestra cómo está resuelta una feature de punta a punta:
captura de leads desde varias fuentes, listado con filtros y búsqueda, y la vista
de detalle.

> **Esto no es la app completa ni corre por sí sola.** Es una selección de archivos
> representativos para mostrar el trabajo. Se quitaron todos los datos, secretos y
> credenciales; los nombres, dominios e IDs que aparecen son ficticios o
> placeholders. Varios módulos compartidos (server actions de contactos/empresas,
> componentes de UI, el esquema de Prisma) se **referencian pero se omiten** a
> propósito.

## Qué muestra

- **Captura de leads multi-fuente** (`app/api/leads/`): rutas que crean leads desde
  una extensión de LinkedIn, desde Gmail y desde emails entrantes, más una ruta de
  enriquecimiento de datos de la empresa. Autenticación por API key / JWT y CORS
  acotado por origen.
- **Listado con filtros y búsqueda** (`app/commercial/leads/`): tabla, panel de
  filtros, búsqueda, y el cliente de listado. La lógica de filtrado vive en utils
  puros y testeables (`app/lib/commercialFilters.ts`).
- **Detalle de lead** (`app/commercial/leads/[id]/`): vista de detalle con su
  timeline de actividad y estados de archivado.

## Stack

Next.js (App Router) · TypeScript · React · Server Actions · Prisma (esquema
omitido en este extracto).

## Estructura del extracto

```
app/
├── commercial/leads/          UI: listado, filtros, búsqueda, detalle, alta
│   ├── page.tsx               listado (server component)
│   ├── LeadsTable.tsx         tabla
│   ├── LeadsFilter*.tsx       filtros y dropdown
│   ├── LeadsSearch*.tsx       búsqueda
│   ├── LeadListClient.tsx     cliente de listado
│   ├── [id]/                  detalle de un lead
│   └── new/                   alta de lead
├── api/leads/                 captura de leads (integraciones)
│   ├── from-linkedin/         desde la extensión de LinkedIn
│   ├── from-email/            desde emails entrantes
│   ├── fetch-gmail/           desde Gmail
│   └── enrich-company/        enriquecimiento de datos de empresa
└── lib/
    ├── commercialFilters.ts       lógica de filtrado (pura)
    └── commercialFilterOptions.ts opciones de filtros
```

## Notas

- **Sanitizado para portfolio:** sin base de datos, sin `.env`, sin claves. Las API
  keys aparecen como placeholders (`"your-extension-api-key"`) y los hosts como
  `YOUR_SERVER_IP` / `example`.
- **Solo lectura:** pensado para leerse, no para `npm install && run` — faltan a
  propósito las dependencias compartidas del CRM.
