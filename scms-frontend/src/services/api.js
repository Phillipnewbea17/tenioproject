const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api"
).replace(/\/+$/, "");

function authHeaders() {
  const token =
    localStorage.getItem("scms_token") ||
    sessionStorage.getItem("scms_token");

  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// SENIOR CITIZENS

export async function getSeniorCitizens() {
  const response = await fetch(`${API_URL}/senior-citizens`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to load senior citizens");
  }

  return response.json();
}

export async function createSeniorCitizen(data) {
  const response = await fetch(`${API_URL}/senior-citizens`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Laravel validation error:", errorData);
    throw new Error("Failed to create senior citizen");
  }

  return response.json();
}

export async function updateSeniorCitizen(id, data) {
  const response = await fetch(`${API_URL}/senior-citizens/${id}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Laravel update error:", errorData);
    throw new Error("Failed to update senior citizen");
  }

  return response.json();
}

// ANNOUNCEMENTS

export async function getAnnouncements() {
  const response = await fetch(`${API_URL}/announcements`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to load announcements");
  }

  return response.json();
}

export async function createAnnouncement(data) {
  const response = await fetch(`${API_URL}/announcements`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Laravel announcement error:", errorData);
    throw new Error("Failed to create announcement");
  }

  return response.json();
}

export async function updateAnnouncement(id, data) {
  const response = await fetch(`${API_URL}/announcements/${id}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Laravel announcement update error:", errorData);
    throw new Error("Failed to update announcement");
  }

  return response.json();
}

export async function deleteAnnouncement(id) {
  const response = await fetch(`${API_URL}/announcements/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to delete announcement");
  }

  return response.json();
}

// APPLICATIONS

export async function getApplications() {
  const response = await fetch(`${API_URL}/applications`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to load applications");
  }

  return response.json();
}

export async function updateApplication(id, data) {
  const response = await fetch(`${API_URL}/applications/${id}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Laravel application update error:", errorData);
    throw new Error("Failed to update application");
  }

  return response.json();
}

export async function deleteApplication(id) {
  const response = await fetch(`${API_URL}/applications/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to delete application");
  }

  return response.json();
}

// LOGIN AND LOGOUT

export async function loginUser(username, password) {
  const response = await fetch(`${API_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      username,
      password,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Login failed");
  }

  return data;
}

export async function logoutUser() {
  const token =
    localStorage.getItem("scms_token") ||
    sessionStorage.getItem("scms_token");

  if (!token) return;

  const response = await fetch(`${API_URL}/logout`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error("Logout failed");
  }

  return response.json();
}

// PASSWORD RECOVERY

export async function resetPassword({
  token,
  email,
  password,
  password_confirmation,
}) {
  const response = await fetch(`${API_URL}/reset-password`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token,
      email,
      password,
      password_confirmation,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const validationMessage = Object.values(data.errors || {})
      .flat()
      .find(Boolean);

    throw new Error(
      validationMessage || data.message || "Unable to reset your password."
    );
  }

  return data;
}

export async function sendPasswordResetLink(email) {
  const response = await fetch(`${API_URL}/forgot-password`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();

  if (!response.ok) {
    const validationMessage = Object.values(data.errors || {})
      .flat()
      .find(Boolean);

    throw new Error(
      validationMessage ||
        data.message ||
        "Unable to send the reset link. Please try again."
    );
  }

  return data;
}

// PENSION RELEASES

function mapPensionRelease(row) {
  return {
    id: row.id,
    seniorId: row.senior_id || "",
    name: row.name || "",
    period: row.period || "",
    releaseDate: row.release_date ? String(row.release_date).slice(0, 10) : "",
    receivedBy: row.received_by || "Senior",
    status: row.status || "Pending",
    reference: row.reference || "",
    remarks: row.remarks || "",
    createdAt: row.created_at || "",
    amount: row.amount != null ? String(Number(row.amount)) : "",
    fundId: row.fund_id ?? null,
    fundReference: row.fund?.reference || "",
    fundName: row.fund?.name || "",
    paidFromFund: Boolean(row.fund_transaction_id),
  };
}

function pensionPayload(form) {
  return {
    senior_id: form.seniorId,
    name: form.name,
    period: form.period,
    release_date: form.releaseDate || null,
    received_by: form.receivedBy,
    status: form.status,
    reference: form.reference || null,
    remarks: form.remarks || null,
    amount: form.amount || null,
    fund_id: form.fundId || null,
  };
}

export async function updatePensionRelease(id, form) {
  return mapPensionRelease(
    await apiRequest(`/pension-releases/${id}`, {
      method: "PATCH",
      body: JSON.stringify(pensionPayload(form)),
    }, "Pension request")
  );
}

export async function getPensionReleases() {
  const rows = await apiRequest("/pension-releases", {}, "Pension request");
  return rows.map(mapPensionRelease);
}

export async function createPensionRelease(form) {
  return mapPensionRelease(
    await apiRequest("/pension-releases", {
      method: "POST",
      body: JSON.stringify(pensionPayload(form)),
    }, "Pension request")
  );
}

// USER MANAGEMENT
//
// These routes are assumed; confirm them in your backend routes/api.php:
// GET   /api/users
// POST  /api/users
// PATCH /api/users/{id}
// POST  /api/users/{id}/reset-password

async function userManagementRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
  });

  const text = await response.text();
  let result = null;

  if (text.trim()) {
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(
        `User Management received a non-JSON response (HTTP ${response.status}). Check the backend API route.`
      );
    }
  }

  if (!response.ok) {
    const validationMessage = Object.values(result?.errors || {})
      .flat()
      .find(Boolean);

    throw new Error(
      validationMessage ||
        result?.message ||
        `User Management request failed (HTTP ${response.status}).`
    );
  }

  return result;
}

function savedUserFromResponse(result) {
  const user = result?.user ?? result?.data ?? result;

  if (!user || typeof user !== "object" || user.id == null) {
    throw new Error(
      "The request succeeded, but the API did not return the saved user record. Refresh the page to check the result."
    );
  }

  return user;
}

export async function getUsers() {
  const result = await userManagementRequest("/users");

  const users = Array.isArray(result)
    ? result
    : result?.data ?? result?.users;

  if (!Array.isArray(users)) {
    throw new Error("The API did not return a valid list of users.");
  }

  return users;
}

export async function createUser(data) {
  const result = await userManagementRequest("/users", {
    method: "POST",
    body: JSON.stringify(data),
  });

  return savedUserFromResponse(result);
}

export async function updateUser(id, data) {
  const result = await userManagementRequest(
    `/users/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    }
  );

  return savedUserFromResponse(result);
}

export async function resetUserPassword(id, password, confirmation) {
  return userManagementRequest(
    `/users/${encodeURIComponent(id)}/reset-password`,
    {
      method: "POST",
      body: JSON.stringify({
        password,
        password_confirmation: confirmation,
      }),
    }
  );
}

function mapMedicalRequest(row) {
  return {
    id: row.id,
    source: row.source || "Walk-in",
    amount: row.amount != null ? String(Number(row.amount)) : "",
    fundId: row.fund_id ?? null,
    fundReference: row.fund?.reference || "",
    fundName: row.fund?.name || "",
    paidFromFund: Boolean(row.fund_transaction_id),
    reference: row.reference || "",
    seniorName: row.senior_name || "",
    seniorId: row.senior_id || "",
    deathDate: row.death_date
  ? String(row.death_date).slice(0, 10)
  : "",
    purok: row.purok || "",
    contact: row.contact || "",
    funeralHome: row.funeral_home || "",
    assistanceType: row.assistance_type || "Medicine",
    requestDate: row.request_date
      ? String(row.request_date).slice(0, 10)
      : "",
    facility: row.facility || "",
    status: row.status || "Pending",
    completedDate: row.completed_date
      ? String(row.completed_date).slice(0, 10)
      : "",
    receivedBy: row.received_by || "",
    remarks: row.remarks || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function medicalRequestPayload(data) {
  return {
    reference: data.reference || null,
    senior_name: data.seniorName,
    senior_id: data.seniorId,
    purok: data.purok || null,
    contact: data.contact || null,
    assistance_type: data.assistanceType,
    request_date: data.requestDate,
    facility: data.facility || null,
    status: data.status,
    completed_date: data.completedDate || null,
    received_by: data.receivedBy || null,
    amount: data.amount || null,
    fund_id: data.fundId || null,
    remarks: data.remarks || null,
  };
}

export async function getMedicalRequests() {
  const response = await fetch(`${API_URL}/medical-requests`, {
    headers: authHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to load medical requests");
  }

  return data.map(mapMedicalRequest);
}

export async function createMedicalRequest(request) {
  const response = await fetch(`${API_URL}/medical-requests`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(medicalRequestPayload(request)),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Laravel medical request error:", data);
    throw new Error(data.message || "Failed to create medical request");
  }

  return mapMedicalRequest(data);
}

export async function updateMedicalRequest(id, request) {
  const response = await fetch(`${API_URL}/medical-requests/${id}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(medicalRequestPayload(request)),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to update medical request");
  }

  return mapMedicalRequest(data);
}

export async function deleteMedicalRequest(id) {
  const response = await fetch(`${API_URL}/medical-requests/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to delete medical request");
  }

  return data;
}

function mapBurialRequest(row) {
  return {
    id: row.id,
    source: row.source || "Walk-in",
    amount: row.amount != null ? String(Number(row.amount)) : "",
    fundId: row.fund_id ?? null,
    fundReference: row.fund?.reference || "",
    fundName: row.fund?.name || "",
    paidFromFund: Boolean(row.fund_transaction_id),
    reference: row.reference || "",
    seniorName: row.senior_name || "",
    claimantName: row.claimant_name || "",
    seniorId: row.senior_id || "",
    purok: row.purok || "",
    contact: row.contact || "",
    requestDate: row.request_date
      ? String(row.request_date).slice(0, 10)
      : "",
    status: row.status || "Pending",
    relationship: row.relationship || "",
    releaseDate: row.release_date
      ? String(row.release_date).slice(0, 10)
      : "",
    receivedBy: row.received_by || "",
    remarks: row.remarks || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function burialRequestPayload(data) {
  return {
    reference: data.reference || null,
    senior_name: data.seniorName,
    claimant_name: data.claimantName,
    senior_id: data.seniorId || null,
    death_date: data.deathDate || null,
    purok: data.purok || null,
    contact: data.contact || null,
    funeral_home: data.funeralHome || null,
    request_date: data.requestDate,
    status: data.status,
    relationship: data.relationship,
    release_date: data.releaseDate || null,
    received_by: data.receivedBy || null,
    amount: data.amount || null,
    fund_id: data.fundId || null,
    remarks: data.remarks || null,
  };
}

export async function getBurialRequests() {
  const response = await fetch(`${API_URL}/burial-requests`, {
    headers: authHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to load burial requests");
  }

  return data.map(mapBurialRequest);
}

export async function createBurialRequest(request) {
  const response = await fetch(`${API_URL}/burial-requests`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(burialRequestPayload(request)),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Laravel burial request error:", data);
    throw new Error(data.message || "Failed to create burial request");
  }

  return mapBurialRequest(data);
}

export async function updateBurialRequest(id, request) {
  const response = await fetch(`${API_URL}/burial-requests/${id}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(burialRequestPayload(request)),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to update burial request");
  }

  return mapBurialRequest(data);
}

export async function deleteBurialRequest(id) {
  const response = await fetch(`${API_URL}/burial-requests/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to delete burial request");
  }

  return data;
}
// SENIOR ID MANAGEMENT

function mapSeniorId(row) {
  const senior = row.senior || {};

  return {
    id: row.id,
    idNumber: row.id_number || "",
    status: row.status || "Pending Issuance",
    dateIssued: row.date_issued || "",
    issuedBy: row.issued_by || "",
    remarks: row.remarks || "",
    replacementReason: row.replacement_reason || "",
    replacementRequestedAt: row.replacement_requested_at || "",
    replacementSource: row.replacement_source || "",
    replacedBy: row.replaced_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    senior: {
      id: senior.id ?? null,
      seniorId: senior.senior_id || "",
      name: senior.name || "",
      age: senior.age ?? null,
      birthDate: senior.birth_date || "",
      gender: senior.gender || "",
      purok: senior.purok || "",
      status: senior.status || "",
      registeredAt: senior.registered_at
        ? String(senior.registered_at).slice(0, 10)
        : "",
    },
    history: Array.isArray(row.history)
      ? row.history.map((entry) => ({
          id: entry.id,
          action: entry.action || "",
          details: entry.details || "",
          reason: entry.reason || "",
          previousIdNumber: entry.previous_id_number || "",
          newIdNumber: entry.new_id_number || "",
          dateRequested: entry.date_requested || "",
          dateProcessed: entry.date_processed || "",
          performedBy: entry.performed_by || "",
          createdAt: entry.created_at || "",
        }))
      : null,
  };
}

// Shared request helper for the Senior ID, Reports, Activity Log, Funds and
// Help Desk modules: sends JSON with the login token and, on failure, throws
// the first Laravel validation message (or the API's message).
async function apiRequest(path, options = {}, label = "Request") {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const validationMessage = Object.values(result?.errors || {})
      .flat()
      .find(Boolean);

    throw new Error(
      validationMessage ||
        result?.message ||
        `${label} failed (HTTP ${response.status}).`
    );
  }

  return result;
}

const seniorIdRequest = (path, options) =>
  apiRequest(`/senior-ids${path}`, options, "Senior ID request");

export async function getSeniorIds() {
  const rows = await seniorIdRequest("");
  return rows.map(mapSeniorId);
}

// { eligible, ids } for one senior, current ID first.
export async function getSeniorIdsForSenior(seniorCitizenId) {
  const result = await apiRequest(`/senior-citizens/${seniorCitizenId}/senior-ids`, {}, "Senior ID request");
  return { eligible: result.eligible, ids: result.ids.map(mapSeniorId) };
}

export async function getSeniorId(id) {
  return mapSeniorId(await seniorIdRequest(`/${id}`));
}

export async function issueSeniorId({ seniorCitizenId, status, dateIssued, remarks }) {
  const row = await seniorIdRequest("", {
    method: "POST",
    body: JSON.stringify({
      senior_citizen_id: seniorCitizenId,
      status,
      date_issued: status === "Active" ? dateIssued : null,
      remarks: remarks || null,
    }),
  });

  return mapSeniorId(row);
}

export async function activateSeniorId(id, dateIssued) {
  const row = await seniorIdRequest(`/${id}/activate`, {
    method: "POST",
    body: JSON.stringify({ date_issued: dateIssued }),
  });

  return mapSeniorId(row);
}

export async function updateSeniorId(id, { dateIssued, remarks }) {
  const row = await seniorIdRequest(`/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      date_issued: dateIssued || null,
      remarks: remarks || null,
    }),
  });

  return mapSeniorId(row);
}

export async function requestSeniorIdReplacement(id, { reason, dateRequested, remarks }) {
  const row = await seniorIdRequest(`/${id}/request-replacement`, {
    method: "POST",
    body: JSON.stringify({
      reason,
      date_requested: dateRequested,
      remarks: remarks || null,
    }),
  });

  return mapSeniorId(row);
}

export async function replaceSeniorId(id, { reason, dateRequested, remarks }) {
  const result = await seniorIdRequest(`/${id}/replace`, {
    method: "POST",
    body: JSON.stringify({
      reason,
      date_requested: dateRequested || null,
      remarks: remarks || null,
    }),
  });

  return {
    previous: mapSeniorId(result.previous),
    replacement: mapSeniorId(result.replacement),
  };
}

export async function deactivateSeniorId(id, remarks) {
  const row = await seniorIdRequest(`/${id}/deactivate`, {
    method: "POST",
    body: JSON.stringify({ remarks }),
  });

  return mapSeniorId(row);
}

// REPORTS

const reportRequest = (path) =>
  apiRequest(`/reports${path}`, {}, "Report request");

export async function getReportOptions() {
  return reportRequest("/options");
}

// type: "seniors" | "verification" | "programs" | "senior-ids"
// filters: { from, to, purok, status, program } — empty values are skipped.
export async function getReport(type, filters = {}) {
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value)
  );
  const query = params.toString();

  return reportRequest(`/${type}${query ? `?${query}` : ""}`);
}

// Records that a report was printed or exported (shown in the Activity Log).
// Failures are ignored: logging must never block printing or exporting.
export async function logReport({ type, title, format, filters }) {
  try {
    await fetch(`${API_URL}/reports/log`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ type, title, format, filters }),
    });
  } catch (error) {
    console.warn("Could not record report in the Activity Log:", error);
  }
}

// ACTIVITY LOG / AUDIT TRAIL (read-only)

function mapActivityLog(row) {
  return {
    id: row.id,
    createdAt: row.created_at || "",
    userName: row.user_name || "",
    role: row.role || "",
    module: row.module || "",
    action: row.action || "",
    recordType: row.record_type || "",
    recordId: row.record_id ?? null,
    recordLabel: row.record_label || "",
    description: row.description || "",
    changes: row.changes && typeof row.changes === "object" ? row.changes : {},
    ipAddress: row.ip_address || "",
  };
}

const activityLogRequest = (path) =>
  apiRequest(`/activity-logs${path}`, {}, "Activity Log request");

// filters: { search, user, module, action, from, to } — empty values are skipped.
export async function getActivityLogs(filters = {}, page = 1) {
  const params = new URLSearchParams(
    Object.entries({ ...filters, page }).filter(([, value]) => value)
  );
  const result = await activityLogRequest(`?${params}`);

  return {
    entries: result.data.map(mapActivityLog),
    meta: result.meta,
  };
}

export async function getActivityLogOptions() {
  return activityLogRequest("/options");
}

// CURRENT USER

// True for administrators, false for other users, and null when unknown
// (sessions from before the role was saved). Use it only to hide buttons;
// the server enforces every permission.
export function isAdministrator() {
  const role =
    localStorage.getItem("scms_role") || sessionStorage.getItem("scms_role");
  return role ? role === "Administrator" : null;
}

// FUND MANAGEMENT

function mapFundTotals(totals = {}) {
  return {
    allocated: Number(totals.allocated) || 0,
    released: Number(totals.released) || 0,
    disbursed: Number(totals.disbursed) || 0,
    remaining: Number(totals.remaining) || 0,
    unreleased: Number(totals.unreleased) || 0,
    onHand: Number(totals.on_hand) || 0,
  };
}

function mapFundTransaction(row) {
  return {
    id: row.id,
    fundId: row.fund_id,
    fundReference: row.fund_reference || "",
    fundName: row.fund_name || "",
    type: row.type,
    program: row.program || "",
    amount: Number(row.amount) || 0,
    date: row.transaction_date || "",
    referenceNo: row.reference_no || "",
    recipient: row.recipient || "",
    description: row.description || "",
    recordedBy: row.recorded_by || "",
    linkedRecord: row.linked_record || "",
    createdAt: row.created_at || "",
    voidedAt: row.voided_at || "",
    voidedBy: row.voided_by || "",
    voidReason: row.void_reason || "",
  };
}

function mapFund(row) {
  return {
    id: row.id,
    reference: row.reference || "",
    name: row.name || "",
    source: row.source || "",
    category: row.category || "",
    fiscalYear: row.fiscal_year,
    status: row.status || "Active",
    remarks: row.remarks || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    closedAt: row.closed_at || "",
    totals: mapFundTotals(row.totals),
    byProgram: Array.isArray(row.by_program)
      ? row.by_program.map((item) => ({ program: item.program, ...mapFundTotals(item) }))
      : null,
    transactions: Array.isArray(row.transactions)
      ? row.transactions.map(mapFundTransaction)
      : null,
  };
}

const fundRequest = (path, options) =>
  apiRequest(`/funds${path}`, options, "Fund request");

// filters: { fiscal_year, status, category, search } — empty values are skipped.
export async function getFunds(filters = {}) {
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value)
  );
  const result = await fundRequest(params.toString() ? `?${params}` : "");

  return {
    funds: result.funds.map(mapFund),
    dashboard: {
      totals: mapFundTotals(result.dashboard.totals),
      byProgram: result.dashboard.by_program.map((item) => ({ program: item.program, ...mapFundTotals(item) })),
      byYear: result.dashboard.by_year.map((item) => ({ fiscalYear: item.fiscal_year, funds: item.funds, ...mapFundTotals(item) })),
      recent: result.dashboard.recent.map(mapFundTransaction),
    },
    years: result.years,
    categories: result.categories,
  };
}

// [{ id, reference, name, fiscal_year, on_hand }] for active funds that have
// released money for the program and not yet paid it out.
// { program, totals: { allocated, released, disbursed, remaining, unreleased, onHand }, funds: [...] }
// for one program across active funds (shown on the Pension/Medical/Burial pages).
export async function getProgramFundSummary(program) {
  const result = await fundRequest(`/program-summary?program=${encodeURIComponent(program)}`);
  return {
    program: result.program,
    totals: mapFundTotals(result.totals),
    funds: result.funds.map((fund) => ({ id: fund.id, reference: fund.reference, name: fund.name, ...mapFundTotals(fund) })),
  };
}

export async function getAvailableFunds(program) {
  return fundRequest(`/available?program=${encodeURIComponent(program)}`);
}

export async function getFund(id) {
  return mapFund(await fundRequest(`/${id}`));
}

function fundPayload(form) {
  return {
    name: form.name,
    source: form.source,
    category: form.category,
    fiscal_year: Number(form.fiscalYear),
    remarks: form.remarks || null,
  };
}

export async function createFund(form) {
  return mapFund(
    await fundRequest("", {
      method: "POST",
      body: JSON.stringify({
        ...fundPayload(form),
        initial_allocation: form.initialAllocation || null,
        allocation_date: form.initialAllocation ? form.allocationDate : null,
      }),
    })
  );
}

export async function updateFund(id, form) {
  return mapFund(
    await fundRequest(`/${id}`, {
      method: "PATCH",
      body: JSON.stringify(fundPayload(form)),
    })
  );
}

export async function addFundTransaction(fundId, form) {
  return mapFund(
    await fundRequest(`/${fundId}/transactions`, {
      method: "POST",
      body: JSON.stringify({
        type: form.type,
        program: form.program,
        amount: form.amount,
        transaction_date: form.date,
        reference_no: form.referenceNo || null,
        recipient: form.recipient || null,
        description: form.description || null,
      }),
    })
  );
}

export async function voidFundTransaction(fundId, transactionId, reason) {
  return mapFund(
    await fundRequest(`/${fundId}/transactions/${transactionId}/void`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    })
  );
}

export async function closeFund(id, remarks) {
  return mapFund(
    await fundRequest(`/${id}/close`, {
      method: "POST",
      body: JSON.stringify({ remarks: remarks || null }),
    })
  );
}

export async function reopenFund(id, remarks) {
  return mapFund(
    await fundRequest(`/${id}/reopen`, {
      method: "POST",
      body: JSON.stringify({ remarks }),
    })
  );
}

// HELP & COMPLAINT DESK

function mapHelpRequest(row) {
  return {
    id: row.id,
    source: row.source || "Walk-in",
    reference: row.reference || "",
    seniorCitizenId: row.senior_citizen_id ?? null,
    seniorName: row.senior_name || "",
    seniorRecordId: row.senior_record_id || "",
    seniorPurok: row.senior_purok || "",
    category: row.category || "",
    subject: row.subject || "",
    description: row.description || "",
    channel: row.channel || "",
    priority: row.priority || "Normal",
    status: row.status || "Pending",
    assignedUserId: row.assigned_user_id ?? null,
    assignedName: row.assigned_name || "",
    submittedAt: row.submitted_at || "",
    resolution: row.resolution || "",
    resolvedAt: row.resolved_at || "",
    daysToResolve: row.days_to_resolve ?? null,
    closedAt: row.closed_at || "",
    remarks: row.remarks || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updates: Array.isArray(row.updates)
      ? row.updates.map((u) => ({
          id: u.id,
          type: u.type,
          fromStatus: u.from_status || "",
          toStatus: u.to_status || "",
          note: u.note || "",
          userName: u.user_name || "",
          createdAt: u.created_at || "",
        }))
      : null,
    seniorHistory: Array.isArray(row.senior_history)
      ? row.senior_history.map(mapHelpRequest)
      : null,
  };
}

const helpRequest = (path, options) =>
  apiRequest(path, options, "Help desk request");

// filters: { search, status, category, priority, assigned } — empty values are skipped.
// assigned: a user id, "me" or "unassigned".
export async function getHelpRequests(filters = {}) {
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value)
  );
  const result = await helpRequest(`/help-requests${params.toString() ? `?${params}` : ""}`);

  return {
    requests: result.requests.map(mapHelpRequest),
    counts: result.counts,
    mineOpen: result.mine_open,
  };
}

export async function getHelpRequestOptions() {
  return helpRequest("/help-requests/options");
}

export async function getHelpRequest(id) {
  return mapHelpRequest(await helpRequest(`/help-requests/${id}`));
}

// Senior Help History for the Records page.
export async function getSeniorHelpHistory(seniorCitizenId) {
  const rows = await helpRequest(`/senior-citizens/${seniorCitizenId}/help-requests`);
  return rows.map(mapHelpRequest);
}

function helpDetailsPayload(form) {
  return {
    category: form.category,
    subject: form.subject,
    description: form.description,
    channel: form.channel || null,
    priority: form.priority || "Normal",
    remarks: form.remarks || null,
  };
}

export async function createHelpRequest(form) {
  return mapHelpRequest(
    await helpRequest("/help-requests", {
      method: "POST",
      body: JSON.stringify({
        ...helpDetailsPayload(form),
        senior_citizen_id: form.seniorCitizenId,
        submitted_at: form.submittedAt,
        assigned_user_id: form.assignedUserId || null,
      }),
    })
  );
}

export async function updateHelpRequest(id, form) {
  return mapHelpRequest(
    await helpRequest(`/help-requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify(helpDetailsPayload(form)),
    })
  );
}

export async function assignHelpRequest(id, assignedUserId, note) {
  return mapHelpRequest(
    await helpRequest(`/help-requests/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ assigned_user_id: assignedUserId || null, note: note || null }),
    })
  );
}

// status: "Working on it" | "Resolved" | "Closed"
export async function changeHelpRequestStatus(id, { status, note, resolution, resolvedAt }) {
  return mapHelpRequest(
    await helpRequest(`/help-requests/${id}/status`, {
      method: "POST",
      body: JSON.stringify({
        status,
        note: note || null,
        resolution: resolution || null,
        resolved_at: resolvedAt || null,
      }),
    })
  );
}

export async function reopenHelpRequest(id, note) {
  return mapHelpRequest(
    await helpRequest(`/help-requests/${id}/reopen`, {
      method: "POST",
      body: JSON.stringify({ note }),
    })
  );
}

export async function addHelpRequestNote(id, note) {
  return mapHelpRequest(
    await helpRequest(`/help-requests/${id}/notes`, {
      method: "POST",
      body: JSON.stringify({ note }),
    })
  );
}

// DASHBOARD

// One summary per sidebar module (see DashboardController). Field names are
// kept as the API sends them (snake_case).
export async function getDashboardSummary() {
  return apiRequest("/dashboard", {}, "Dashboard request");
}
