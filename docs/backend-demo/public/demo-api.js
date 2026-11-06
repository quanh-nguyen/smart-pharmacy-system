// MEDIBRIDGE — browser client. Same origin as server.js (no localStorage token).
(() => {
  'use strict';
  async function request(url,{method='GET',body,headers={}}={}){
    const response=await fetch(url,{
      method,credentials:'same-origin',
      headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    let value;
    try{value=await response.json();}catch{throw new Error(`Phản hồi không hợp lệ (HTTP ${response.status}).`);}
    if(!response.ok||!value.success)throw new Error(value.message||`HTTP ${response.status}`);
    return value.data;
  }
  const q = value => encodeURIComponent(String(value||''));
  const id = value => encodeURIComponent(String(value));
  window.DemoAPI = {
    request,
    health:()=>request('/api/health'),
    me:()=>request('/api/me'),
    login:(email,password)=>request('/api/auth/login',{method:'POST',body:{email,password}}),
    register:(name,email,password)=>request('/api/auth/register',{method:'POST',body:{name,email,password}}),
    logout:()=>request('/api/auth/logout',{method:'POST'}),
    pharmacies:(search='')=>request(`/api/pharmacies?q=${q(search)}`),
    medicines:(search='')=>request(`/api/medicines?q=${q(search)}`),
    search:(search='')=>request(`/api/search?q=${q(search)}`),
    inventory:(pharmacyId)=>request(`/api/pharmacies/${id(pharmacyId)}/inventory`),
    orders:()=>request('/api/orders'),
    createOrder:({pharmacyId,items,shippingAddress,phone,prescriptionId=null,note=''})=>
      request('/api/orders',{method:'POST',body:{pharmacyId,items,shippingAddress,phone,prescriptionId,note}}),
    updateOrderStatus:(orderId,status,note='')=>request(`/api/orders/${id(orderId)}/status`,{method:'PATCH',body:{status,note}}),
    notifications:()=>request('/api/notifications'),
    markNotificationRead:notificationId=>request(`/api/notifications/${id(notificationId)}/read`,{method:'PATCH'}),
    parsePrescriptionText:text=>request('/api/prescriptions/parse-text',{method:'POST',body:{text}}),
    prescriptions:()=>request('/api/prescriptions'),
    createPrescription:items=>request('/api/prescriptions',{method:'POST',body:{items}}),
    confirmPrescription:prescriptionId=>request(`/api/prescriptions/${id(prescriptionId)}/confirm`,{method:'POST'}),
    evaluateSymptoms:(difficultyBreathing,severeSymptoms)=>
      request('/api/symptoms/evaluate',{method:'POST',body:{difficultyBreathing,severeSymptoms}}),
    adminPharmacies:()=>request('/api/admin/pharmacies'),
    verifyPharmacy:(pharmacyId,status)=>request(`/api/admin/pharmacies/${id(pharmacyId)}/verification`,{method:'PATCH',body:{status}}),
    updateInventory:(pharmacyId,medicineId,price,quantity)=>request(`/api/admin/inventory/${id(pharmacyId)}/${id(medicineId)}`,
      {method:'PUT',body:{price,quantity}})
  };
})();
