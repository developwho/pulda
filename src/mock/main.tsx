import { installMockTransport } from './transport';

installMockTransport();
// The mock transport must exist before the same application's stores establish their connections.
void import('./mount').catch(() => {
  document.getElementById('root')!.textContent = '목업 화면을 불러오지 못했어요. 새로고침해 주세요.';
});
