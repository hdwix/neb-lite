declare module '@nestjs/axios' {
  import { Observable } from 'rxjs';

  export class HttpService {
    post<T = any>(url: string, body?: unknown): Observable<T>;
  }
}
