import type { DriverPickApi } from '../shared/types'

declare global {
  interface Window {
    driverpick: DriverPickApi
  }
}

export {}
