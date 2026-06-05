/** @odoo-module **/

import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { markup } from "@odoo/owl";

async function actionGetDrive(env, action, type) {
    const { drive_id, sign_host: host } = action.params;
    const { orm, http, dialog, action: actionService, notification } = env.services;

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

    if (type === "sign" && action.params.invoices) {
        
        const parsedInvoices = typeof action.params.invoices === "string" 
            ? JSON.parse(action.params.invoices) 
            : action.params.invoices;
            
        const invoiceIds = Object.keys(parsedInvoices);
        let successCount = 0;
        let failedInvoices = []; 
        
        console.log(` Found ${invoiceIds.length} actual invoices to process.`);
        
        for (let i = 0; i < invoiceIds.length; i++) {
            const invId = invoiceIds[i];
            console.log(` Processing invoice ${i + 1} of ${invoiceIds.length}...`);
            
            const singleInvoiceData = { [invId]: parsedInvoices[invId] };
            const singlePayload = {
                ...action.params,
                invoices: JSON.stringify(singleInvoiceData)
            };
            
            try {
                let chunkResult = await http.post(route, singlePayload);
                
                if (chunkResult[key]) {
                    console.log(` Signature successful! Pushing to Odoo server immediately...`);
                    await orm.call("l10n_eg_edi.thumb.drive", method, [[drive_id], chunkResult[key]]);
                    successCount++;
                    console.log(` Invoice ${i + 1} is safely in Odoo!`);
                } else if (chunkResult.error) {
                    console.error(` Token error on invoice ${invId}:`, chunkResult.error);
                    failedInvoices.push(`- Invoice ID ${invId}: ${chunkResult.error}`);
                    
                    // Stop the loop instantly if token is missing
                    const errStr = chunkResult.error.toLowerCase();
                    if (errStr.includes("token") || errStr.includes("pin") || errStr.includes("found")) {
                        break; 
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (e) {
                console.error("Connection lost during loop", e);
                failedInvoices.push(`- Invoice ID ${invId}: Failed to connect to middleware`);
                break; // Stop loop if middleware crashes
            }
        }
        
        console.log(`Finished! Successfully pushed ${successCount} out of ${invoiceIds.length} invoices.`);
        
        // ------------------------------------------------------------------
        // SUCCESS / ERROR NOTIFICATIONS
        // ------------------------------------------------------------------
        if (successCount === invoiceIds.length && invoiceIds.length > 0) {
            // 100% Success: Show Green Toast
            notification.add(
                _t("All invoices have been signed and uploaded successfully."),
                { title: _t("Success!"), type: "success" }
            );
        } else {
            // Partial Success or Failure: Show Popup with Errors
            let messageBody = "";
            if (successCount > 0) {
                messageBody = _t("Partial success: Some invoices were signed, but others failed.") + 
                              "<br/><br/><b>" + _t("Errors:") + "</b><br/>" + failedInvoices.join("<br/>");
            } else {
                messageBody = _t("Failed: No invoices could be signed. Please check your USB token.") + 
                              "<br/><br/><b>" + _t("Errors:") + "</b><br/>" + failedInvoices.join("<br/>");
            }
            
            await dialog.add(AlertDialog, {
                body: markup(messageBody),
                confirmLabel: _t("OK"),
            });
        }

        actionService.doAction({ type: "ir.actions.client", tag: "reload" });
        return;
        
    } else {
        // ------------------------------------------------------------------
        // CERTIFICATES LOGIC
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
            
            // Show Green Toast for Certificate Success
            notification.add(
                _t("Certificate has been set up successfully."),
                { title: _t("Success!"), type: "success" }
            );
            
            actionService.doAction({ type: "ir.actions.client", tag: "reload" });
        }
    }
}

registry
    .category("actions")
    .add("action_get_drive_certificate", (env, action) => actionGetDrive(env, action, "certificate"));
registry
    .category("actions")
    .add("action_post_sign_invoice", (env, action) => actionGetDrive(env, action, "sign"));