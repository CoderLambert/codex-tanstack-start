/* eslint-disable */
// @ts-nocheck
// Minimal generated-style route tree. TanStack's Vite plugin may overwrite this file.
import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'

const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)

export interface FileRouteTypes {
  fileRoutesByFullPath: { '/': typeof IndexRoute }
  fullPaths: '/'
  fileRoutesByTo: { '/': typeof IndexRoute }
  to: '/'
  id: '__root__' | '/'
  fileRoutesById: { __root__: typeof rootRouteImport; '/': typeof IndexRoute }
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren = { IndexRoute }
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()

import type { getRouter } from './router'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
  }
}
