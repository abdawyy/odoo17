/** @odoo-module **/

import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { markup } from "@odoo/owl"; 

async function actionGetDrive(env, action, type) {
    const { drive_id, sign_host: host } = action.params;
    const { orm, http, dialog, action: actionService } = env.services;

    let route = host;
    let method, key;

    // ------------------------------------------------------------------
    // SCENARIO 1: SIGNING INVOICES
    // ------------------------------------------------------------------
    if (type === "sign") {
        route += "/hw_l10n_eg_eta/sign";
        method = "set_signature_data";
        key = "invoices";

        // FATAL CHECK: Did the Python backend actually send us invoices?
        if (!action.params.invoices || action.params.invoices === "{}" || action.params.invoices === "[]") {
            await dialog.add(AlertDialog, {
                body: _t("No valid invoices were received from Odoo. Ensure the selected invoices are 'Posted' and not already signed."),
                confirmLabel: _t("OK"),
            });
            return; // Stop execution immediately
        }

        const parsedInvoices = typeof action.params.invoices === "string" 
            ? JSON.parse(action.params.invoices) 
            : action.params.invoices;
            
        const invoiceIds = Object.keys(parsedInvoices);
        
        // Secondary check just in case parsing resulted in an empty object
        if (invoiceIds.length === 0) {
            await dialog.add(AlertDialog, {
                body: _t("The invoice list is empty. Cannot proceed with signing."),
            });
            return;
        }

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
                    failedInvoices.push({ id: invId, error: chunkResult.error });
                    
                    const errStr = chunkResult.error.toLowerCase();
                    if (errStr.includes("token") || errStr.includes("pin") || errStr.includes("found")) {
                        break; // Abort loop if the flash memory is missing
                    }
                }
                
                // Pause for 2 seconds to let the USB token breathe
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (e) {
                await dialog.add(AlertDialog, {
                    body: _t("Error trying to connect to the middleware. Is the middleware running?"),
                });
                return; 
            }
        }
        
        let errorDetails = "";
        if (failedInvoices.length > 0) {
            errorDetails = "<br/><br/><b>" + _t("Failed Invoices:") + "</b><br/>";
            failedInvoices.forEach(failed => {
                errorDetails += `- Invoice ID ${failed.id}: ${failed.error}<br/>`;
            });
        }
        
        let messageBody = "";
        if (successCount === invoiceIds.length && invoiceIds.length > 0) {
            messageBody = _t("Success! All invoices have been signed and uploaded successfully.");
        } else if (successCount > 0) {
            messageBody = _t("Partial success: Some invoices were successfully signed, but others failed.") + errorDetails;
        } else {
            messageBody = _t("Failed: No invoices could be signed. Please check your USB token and middleware.") + errorDetails;
        }
        
        await dialog.add(AlertDialog, {
            body: markup(messageBody),
            confirmLabel: _t("OK"),
        });
        
        actionService.doAction({ type: "ir.actions.client", tag: "reload" });
        return;
    } 
    
    // ------------------------------------------------------------------
    // SCENARIO 2: SETTING UP THE CERTIFICATE
    // ------------------------------------------------------------------
    else if (type === "certificate") {
        route += "/hw_l10n_eg_eta/certificate";
        method = "set_certificate";
        key = "certificate";

        let result = {};
        try {
            result = await http.post(route, action.params);
        } catch {
            await dialog.add(AlertDialog, {
                body: _t("Error trying to connect to the middleware. Is the middleware running?"),
            });
            return;
        }
        
        if (result.error) {
            await dialog.add(AlertDialog, { body: _t("Unexpected error: ") + result.error });
        } else if (result[key]) {
            await orm.call("l10n_eg_edi.thumb.drive", method, [[drive_id], result[key]]);
            await dialog.add(AlertDialog, {
                body: _t("Success! Certificate has been set up successfully."),
                confirmLabel: _t("OK"),
            });
            actionService.doAction({ type: "ir.actions.client", tag: "reload" });
        } else {
            // Catch-all if the middleware returns weird empty data
            await dialog.add(AlertDialog, { body: _t("Unknown error: No certificate data returned from middleware.") });
        }
    }
}

registry
    .category("actions")
    .add("action_get_drive_certificate", (env, action) => actionGetDrive(env, action, "certificate"));
registry
    .category("actions")
    .add("action_post_sign_invoice", (env, action) => actionGetDrive(env, action, "sign"));