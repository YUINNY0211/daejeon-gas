// 폐기된 기존 제보 경로(승인된 방침): 조회는 빈 목록, 등록은 차단합니다. DB를 읽거나 쓰지 않습니다.
// 기존 feedback·votes 테이블과 데이터는 그대로 보존됩니다. 새 제보는 /api/citizen/* 을 사용합니다.
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export function onRequestGet(){return Response.json([],{headers});}
export function onRequestPost(){return Response.json({error:'feedback_retired'},{status:410,headers});}
export function onRequest(){return Response.json({error:'method_not_allowed'},{status:405,headers:{...headers,Allow:'GET, POST'}});}
