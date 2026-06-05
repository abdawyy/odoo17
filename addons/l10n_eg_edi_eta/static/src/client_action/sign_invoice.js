/** @odoo-module **/

import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { markup } from "@odoo/owl"; // <-- IMPORTANT: Needed to render line breaks in the dialog

async function actionGetDrive(env, action, type) {
    const { drive_id, sign_host: host } = action.params;
    const { orm, http, dialog, action: actionService } = env.services;

    let route = host;
    let key, method;
    if (type === "certificate") {
        route += "/hw_l10n_eg_eta/certificate";
        method = "set_certificate";
        key = "certificate";
    } else if (type === "sign") {
        route += "/hw_l10n_eg_eta/sign";
        method = "set_signature_data";
        key = "invoices";
    }

    let result = {};

    // ------------------------------------------------------------------
    // FIXED CODE: Processing Invoices
    // ------------------------------------------------------------------
    if (type === "sign" && action.params.invoices) {
        
        const parsedInvoices = typeof action.params.invoices === "string" 
            ? JSON.parse(action.params.invoices) 
            : action.params.invoices;
            
        const invoiceIds = Object.keys(parsedInvoices);
        let successCount = 0;
        let failedInvoices = []; 
        
        console.log(`Found ${invoiceIds.length} actual invoices to process.`);
        
        for (let i = 0; i < invoiceIds.length; i++) {
            const invId = invoiceIds[i];
            const singleInvoiceData = { [invId]: parsedInvoices[invId] };
            
            const singlePayload = {
                ...action.params,
                invoices: JSON.stringify(singleInvoiceData)
            };
            
            try {
                let chunkResult = await http.post(route, singlePayload);
                
                if (chunkResult[key]) {
                    // Success! Push to server
                    await orm.call("l10n_eg_edi.thumb.drive", method, [[drive_id], chunkResult[key]]);
                    successCount++;
                } else if (chunkResult.error) {
                    console.error(`Token error on invoice ${invId}:`, chunkResult.error);
                    failedInvoices.push({
                        id: invId,
                        error: chunkResult.error
                    });
                    
                    // NEW: If the USB token is completely missing or the PIN is wrong, 
                    // abort the loop completely! Don't keep trying and making the user wait.
                    const errStr = chunkResult.error.toLowerCase();
                    if (errStr.includes("token") || errStr.includes("pin") || errStr.includes("found")) {
                        break; 
                    }
                }
                
                // Pause for 2 seconds to let the USB token breathe
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (e) {
                // NEW: This catches when the Middleware is fully CLOSED or crashed.
                // Stop the loop instantly and show the error!
                await dialog.add(AlertDialog, {
                    body: _t("Error trying to connect to the middleware. Is the middleware running?"),
                });
                return; // Exit the entire function
            }
        }
        
        // Build error details message using HTML <br/> so Odoo renders it correctly
        let errorDetails = "";
        if (failedInvoices.length > 0) {
            errorDetails = "<br/><br/><b>" + _t("Failed Invoices:") + "</b><br/>";
            failedInvoices.forEach(failed => {
                errorDetails += `- Invoice ID ${failed.id}: ${failed.error}<br/>`;
            });
        }
        
        // Build the message body safely without relying on %s interpolation
        let messageBody = "";
        if (successCount === invoiceIds.length && invoiceIds.length > 0) {
            messageBody = _t("Success! All invoices have been signed and uploaded successfully.");
        } else if (successCount > 0) {
            messageBody = _t("Partial success: Some invoices were successfully signed, but others failed.") + errorDetails;
        } else {
            messageBody = _t("Failed: No invoices could be signed. Please check your USB token and middleware.") + errorDetails;
        }
        
        // Use markup() so the <br/> and <b> tags actually work visually in Odoo 17
        await dialog.add(AlertDialog, {
            body: markup(messageBody),
            confirmLabel: _t("OK"),
        });
        
        actionService.doAction({
            type: "ir.actions.client",
            tag: "reload",
        });
        return;
        
    } else {
        // ------------------------------------------------------------------
        // ORIGINAL CODE (For Certificate setup)
        // ------------------------------------------------------------------
        try {
            result = await http.post(route, action.params);
        } catch {
            dialog.add(AlertDialog, {
                body: _t("Error trying to connect to the middleware. Is the middleware running?"),
            });
            return;
        }
        
        if (result.error) {
            dialog.add(AlertDialog, { body: _t("Unexpected error: ") + result.error });
        } else if (result[key]) {
            await orm.call("l10n_eg_edi.thumb.drive", method, [[drive_id], result[key]]);
            await dialog.add(AlertDialog, {
                body: type === "certificate" 
                    ? _t("Success! Certificate has been set up successfully.") 
                    : _t("Success! Invoices have been signed and uploaded successfully."),
                confirmLabel: _t("OK"),
            });
            actionService.doAction({ type: "ir.actions.client", tag: "reload" });
        }
    }
}

registry
    .category("actions")
    .add("action_get_drive_certificate", (env, action) =>
        actionGetDrive(env, action, "certificate")
    );
registry
    .category("actions")
    .add("action_post_sign_invoice", (env, action) => actionGetDrive(env, action, "sign"));