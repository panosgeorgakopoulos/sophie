import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),rate:vi.fn()}));
vi.mock('./adminSession',()=>({getAdminSession:mocks.session}));
vi.mock('./rateLimit',()=>({checkRateLimit:mocks.rate}));
import {authorizeAdminApi} from './adminApi';
beforeEach(()=>{vi.resetAllMocks();mocks.rate.mockResolvedValue({success:true});});
describe('review and upload API authorization',()=>{
  it('requires authentication before body parsing or database access',async()=>{
    mocks.session.mockResolvedValue(null);
    await expect(authorizeAdminApi(new Request('http://localhost/api/admin/uploads',{method:'POST'}),['staff','reviewer','admin'])).rejects.toMatchObject({status:401});
    expect(mocks.rate).not.toHaveBeenCalled();
  });
  it('allows staff upload but denies staff knowledge approval',async()=>{
    mocks.session.mockResolvedValue({userId:'staff',role:'staff'});
    const req=new Request('http://localhost/api/admin/uploads',{method:'POST',headers:{Origin:'http://localhost'}});
    await expect(authorizeAdminApi(req)).rejects.toMatchObject({status:403});
    await expect(authorizeAdminApi(req,['staff','reviewer','admin'])).resolves.toMatchObject({role:'staff'});
  });
  it('rejects reviewer mutations from a different origin',async()=>{
    mocks.session.mockResolvedValue({userId:'reviewer',role:'reviewer'});
    await expect(authorizeAdminApi(new Request('http://localhost/api/admin/knowledge',{method:'PATCH',headers:{Origin:'https://attacker.invalid'}}))).rejects.toMatchObject({status:403});
  });
});
